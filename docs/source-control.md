# Source Control

Activity bar → branch icon. PiPilot wraps `simple-git` so you get the full git API without leaving the IDE.

## File-tree decorations

Files in the explorer get VS Code-style status pills:

- `M` modified (yellow)
- `A` added / staged
- `D` deleted (red)
- `U` untracked (green)
- `R` renamed
- Folders carry the worst status of any descendant.

The decorations live-update on every file save / git operation.

## Source Control panel

Three sections:

1. **Changes** — unstaged + untracked files.
2. **Staged Changes** — what your next commit will include.
3. **Recent commits** — last 20 with author + message + relative time.

Click any file → opens a diff view (left = HEAD, right = working copy). Click `+` next to a file → stage. Click `-` next to a staged file → unstage. The `…` menu on each row has the full set of git operations: discard, stash, copy SHA, view at this commit.

## Committing

1. Stage the files you want.
2. Type the commit message in the box at the top of the panel.
3. `Ctrl+Enter` (or click ✓) to commit.

Empty / unstaged commits are rejected with an inline error. Branch name is shown in the status bar — click it to switch / create a branch.

## Pushing / pulling

The `…` menu at the top of the panel:

- **Pull** — `git pull` from the upstream of the current branch.
- **Push** — `git push`. If the branch has no upstream yet, prompts to set it.
- **Sync** — pull then push, the common shortcut.
- **Create remote** — point at a GitHub repo URL to set `origin`.
- **Remove remote** — drop a remote.
- **Discard all changes** — `git checkout -- .` plus `git clean -fd` for untracked. Always asks first.

For one-click "create the GitHub repo and push everything" use the [Deploy Hub](deploy-hub.md)'s **↗ Push project** button instead — it does init + commit + repo create + remote add + push in one shot.

## Inline blame

Click a line → ghost text appears in the gutter showing the author + relative time + commit message. Click it → full commit card opens (GitHub-style: avatar, author + date, full message, list of changed files in the same commit, click any file to view the diff at that commit).

The bundled `git-blame-inline` extension drives this — toggle in **Settings → Features**.

## Diff view

Comes in two flavours:

- **Side-by-side** — left is HEAD (or the chosen base), right is the working copy. Synced scrolling.
- **Inline** — single-column unified diff with `-` / `+` markers. Toggle from the diff toolbar.

Both support:

- Line-by-line stage / unstage (the `+` / `-` in the gutter).
- "View at this commit" — opens the file as it existed at the diff's right side.
- Copy hunk to clipboard.

For binary files (images, videos, PDFs), the diff view falls back to "side-by-side preview" — both versions render natively and you can flip between them with `←` / `→`.

## Branches + tags

Status bar branch name → click → switch / create branch. The popup lists local + remote branches, "Create new branch" at the top.

Tags aren't yet first-class in the UI; use the Terminal for `git tag -a`, `git push --tags`.

## Stash

`…` menu → **Stash all** / **Stash staged** / **Pop stash** / **List stashes**. The list popup shows stash messages with timestamps; click any to apply or drop.

## Submodules

Recognised but not first-class — they show in the file tree with a `⊕` glyph and you can't currently expand them inline. Use the Terminal for `git submodule update --init --recursive`.

## Internal

- Backed by `main/ipc-git.js` which wraps `simple-git`. Every operation is async + cancellable.
- Decorations update on the `git:status` IPC event, throttled to once per 250ms so a `git pull` of 10k files doesn't lag the file tree.
- The `.pipilot/checkpoints/` directory is auto-`.gitignore`'d — it's our internal undo system, separate from git.

## Tips

- The agent can do git too — try "stash my changes, switch to main, pull, then come back and pop". It uses the same `mcp__pipilot__*` tools surfaced as `git_*`.
- Diff view is also opened by clicking any history-row → "Compare with current" in the Source Control panel.
- For one-shot "what changed today?" → status bar → click the branch name → "Show today's commits" (or use `git log --since=midnight` in the Terminal).
