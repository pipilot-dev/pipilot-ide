# Debugging

Node.js debugger built on the Chrome DevTools Protocol — same wire format VS Code uses. Set breakpoints in the Ace gutter, hit `F5`, the IDE spawns `node --inspect-brk` and pauses on entry. Bottom panel → **Debug** tab is the control surface.

## What works today

- **Node.js** scripts (`.js`, `.mjs`, `.cjs`).
- **TypeScript** via direct Node execution (no `ts-node` integration yet — debug the compiled JS or set up a launch config that runs your build first).
- Single active session. Multi-session is on the roadmap.
- Browser DevTools attach (debug embedded-browser pages) is on the roadmap.

## Quick start

1. Open any `.js` / `.mjs` / `.cjs` file.
2. Click the gutter to the left of any line → red dot appears (the breakpoint).
3. Press `F5` (or **Debug → ▶ Debug File**). The IDE spawns Node with `--inspect-brk`, attaches via CDP, pauses on entry.
4. When paused: yellow line marker on the active line, call stack populates, scopes expand on demand.
5. Step through with `F10` (over) / `F11` (into) / `Shift+F11` (out). `F5` continues.

## Breakpoint types

Right-click any gutter line for a context menu:

| Type | Marker | Behaviour |
|------|:--:|---|
| **Breakpoint**             | red dot     | Pauses every time the line runs |
| **Conditional breakpoint** | red `?`     | Pauses only when the JS expression is truthy. Right-click → Add Conditional → enter expression. |
| **Logpoint**               | blue diamond| Logs a message to the console without pausing. Use `${expr}` to interpolate values. |

Conditional and logpoints use the standard CDP idiom — logpoints compile to `(console.log(...), false)` and ride the `condition` field of `Debugger.setBreakpointByUrl` so the runtime evaluates them but never pauses.

## Exception breakpoints

Toolbar dropdown next to the controls: `never / uncaught / caught / all`. Default is `uncaught` — pauses only on errors that aren't caught by a `try/catch`. Persisted in `localStorage`, applied on every session start AND live during a session via `Debugger.setPauseOnExceptions`.

## launch.json

If your project has `.vscode/launch.json`, PiPilot reads it and surfaces every Node-type configuration in the toolbar dropdown. Supported VS Code keys:

- `type: "node" | "pwa-node"` (others show a clear "unsupported" error)
- `program` — entry script
- `args` — passed to your script
- `cwd` — working directory
- `env` — env vars
- `runtimeExecutable` — overrides the default `node` binary
- `runtimeArgs` — flags passed before the script

VS Code-style variable substitution covers the editor-meaningful subset:
`${workspaceFolder}`, `${workspaceFolderBasename}`, `${file}`, `${fileBasename}`,
`${fileBasenameNoExtension}`, `${fileDirname}`, `${fileExtname}`, `${cwd}`,
`${pathSeparator}`, `${env:NAME}`.

JSONC is supported — `//` and `/* */` comments and trailing commas are stripped.

The ⚙ button next to the picker opens (or seeds) `launch.json`. First-time setup writes:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Active File",
      "program": "${file}",
      "cwd": "${workspaceFolder}",
      "args": [],
      "env": {}
    }
  ]
}
```

Pick from the dropdown, hit **▶**, breakpoints fire as expected.

## Node binary resolution

The spawn searches `PATH` for a real `node` binary first. Falls back to Electron's binary with `ELECTRON_RUN_AS_NODE=1` when none is found. Override per-config with `runtimeExecutable` in launch.json.

## Debug panel layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▶ Debug File [▾] launch.json picker  ⚙   ✦ pause exc [▾]                │
│ ⏵ ⤼ ↘ ↗ ⏸ ■                                          STATUS · running   │
├─────────────────┬─────────────────┬──────────────────────────────────────┤
│  Call Stack     │   Scopes        │  Console                             │
│                 │                 │                                      │
│ • myFunc       │ ▾ Local         │ Loaded foo.js                        │
│   foo.js:42    │   x = 5         │ › myValue                            │
│ • main         │   y = 'hello'   │ ‹ 42                                 │
│   foo.js:8     │ ▸ Closure       │ › 1+1                                │
│                │ ▸ Global        │ ‹ 2                                  │
│                 │                 │ ┌──────────────────────────────┐ Run │
│                 │                 │ │ Evaluate in current frame…   │     │
│                 │                 │ └──────────────────────────────┘     │
└─────────────────┴─────────────────┴──────────────────────────────────────┘
```

- **Call Stack** — click any frame to jump to that file:line and update the active scope.
- **Scopes** — expand groups (Local / Closure / Global). Property values lazy-load via `Runtime.getProperties`.
- **Console** — process stdout (white), stderr (red), `console.*` calls (color-coded by level), uncaught exceptions (red).
- **Eval input** — type any JS expression, hit Enter. Evaluates in the active call frame via `Debugger.evaluateOnCallFrame`. Input shown with `›` prefix; result with `‹` prefix.

## Sessions, sockets, ports

- Each debug run picks a free port starting at 9230 (above the standard 9229 to avoid clashing with `node --inspect`).
- Inspector URL is auto-discovered by polling `http://127.0.0.1:<port>/json/list`.
- WebSocket attach via `ws` package; CDP commands multiplexed by id.
- Children are killed on app quit.

## Tips

- Breakpoints persist in `localStorage` per file path — close + reopen a file and your breakpoints come back.
- The pause line auto-scrolls into view; if you've scrolled away while paused, click any frame in the call stack to re-center.
- `Esc` while the input is focused does nothing in the debug panel — use the controls or `F5`.
- Stuck process? `Shift+F5` (Stop) kills both the WS connection and the child node process.
- The agent can debug too — ask "set a breakpoint at foo.js:42 and tell me what `user` looks like" and it'll drive the same UI via `mcp__pipilot__debug_*` tools.
