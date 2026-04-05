import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react";
import { Plus, X, Trash2 } from "lucide-react";
import { db } from "@/lib/db";

interface TerminalLine {
  id: number;
  type: "input" | "output" | "error" | "info" | "success";
  text: string;
}

interface ShellTab {
  id: string;
  name: string;
  lines: TerminalLine[];
  history: string[];
  historyIndex: number;
  cwd: string; // current working directory within the virtual workspace
  nextLineId: number;
}

function createShell(id: string, index: number): ShellTab {
  return {
    id,
    name: `bash ${index}`,
    lines: [
      { id: 0, type: "info", text: `PiPilot IDE Terminal — Shell ${index}` },
      { id: 1, type: "info", text: "Type 'help' for commands. This terminal operates on the virtual workspace (IndexedDB).\n" },
    ],
    history: [],
    historyIndex: -1,
    cwd: "",
    nextLineId: 2,
  };
}

export function TerminalPanel() {
  const [shells, setShells] = useState<ShellTab[]>(() => [createShell("shell-1", 1)]);
  const [activeShellId, setActiveShellId] = useState("shell-1");
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellCounter = useRef(1);

  const activeShell = shells.find((s) => s.id === activeShellId) ?? shells[0];

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [activeShell?.lines.length]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeShellId]);

  const updateShell = useCallback((shellId: string, updater: (shell: ShellTab) => ShellTab) => {
    setShells((prev) => prev.map((s) => (s.id === shellId ? updater(s) : s)));
  }, []);

  const addLines = useCallback(
    (shellId: string, newLines: { type: TerminalLine["type"]; text: string }[]) => {
      updateShell(shellId, (shell) => {
        let nextId = shell.nextLineId;
        const lines = newLines.map((l) => ({ id: nextId++, ...l }));
        return { ...shell, lines: [...shell.lines, ...lines], nextLineId: nextId };
      });
    },
    [updateShell]
  );

  const handleCommand = useCallback(
    async (cmd: string) => {
      const shellId = activeShellId;
      const shell = shells.find((s) => s.id === shellId);
      if (!shell) return;

      const cwd = shell.cwd;
      const prompt = cwd ? `${cwd} $` : "$";

      // Add input line and update history
      addLines(shellId, [{ type: "input", text: `${prompt} ${cmd}` }]);
      updateShell(shellId, (s) => ({
        ...s,
        history: [...s.history, cmd],
        historyIndex: -1,
      }));

      const parts = cmd.trim().split(/\s+/);
      const command = parts[0]?.toLowerCase();
      const arg = parts.slice(1).join(" ").trim();

      try {
        switch (command) {
          case "": break;

          case "help":
            addLines(shellId, [
              { type: "info", text: "Available commands:" },
              { type: "output", text: "  ls [path]        List files in directory" },
              { type: "output", text: "  cd <path>        Change directory" },
              { type: "output", text: "  cat <file>       Print file contents" },
              { type: "output", text: "  head <file>      Print first 20 lines" },
              { type: "output", text: "  wc <file>        Count lines in file" },
              { type: "output", text: "  find <pattern>   Search files by name" },
              { type: "output", text: "  grep <q> <file>  Search content in file" },
              { type: "output", text: "  touch <file>     Create empty file" },
              { type: "output", text: "  rm <file>        Delete file" },
              { type: "output", text: "  mkdir <dir>      Create directory" },
              { type: "output", text: "  pwd              Print working directory" },
              { type: "output", text: "  echo <text>      Print text" },
              { type: "output", text: "  date             Show date/time" },
              { type: "output", text: "  clear            Clear terminal" },
              { type: "output", text: "  whoami           Show current user" },
              { type: "output", text: "" },
            ]);
            break;

          case "clear":
            updateShell(shellId, (s) => ({ ...s, lines: [], nextLineId: 0 }));
            break;

          case "pwd":
            addLines(shellId, [{ type: "output", text: `/${cwd || ""}` }]);
            break;

          case "cd": {
            if (!arg || arg === "/" || arg === "~") {
              updateShell(shellId, (s) => ({ ...s, cwd: "" }));
              break;
            }
            if (arg === "..") {
              const parentParts = cwd.split("/");
              parentParts.pop();
              updateShell(shellId, (s) => ({ ...s, cwd: parentParts.join("/") }));
              break;
            }
            const targetPath = cwd ? `${cwd}/${arg}` : arg;
            const dir = await db.files.get(targetPath);
            if (!dir || dir.type !== "folder") {
              addLines(shellId, [{ type: "error", text: `cd: no such directory: ${arg}` }]);
            } else {
              updateShell(shellId, (s) => ({ ...s, cwd: targetPath }));
            }
            break;
          }

          case "ls": {
            const lsPath = arg
              ? (cwd ? `${cwd}/${arg}` : arg)
              : cwd || "";
            const parentPath = lsPath || "";
            const items = await db.files.where("parentPath").equals(parentPath).toArray();
            if (items.length === 0 && lsPath) {
              const exists = await db.files.get(lsPath);
              if (!exists) {
                addLines(shellId, [{ type: "error", text: `ls: cannot access '${arg || "."}': No such directory` }]);
                break;
              }
            }
            // Sort: folders first, then alphabetical
            items.sort((a, b) => {
              if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
            const output = items
              .map((f) => {
                if (f.type === "folder") return `\x1b[1m${f.name}/\x1b[0m`;
                return f.name;
              })
              .join("  ");
            addLines(shellId, [{ type: "output", text: output || "(empty)" }]);
            break;
          }

          case "cat": {
            if (!arg) { addLines(shellId, [{ type: "error", text: "cat: missing file operand" }]); break; }
            const catPath = cwd ? `${cwd}/${arg}` : arg;
            const file = await db.files.get(catPath);
            if (!file) { addLines(shellId, [{ type: "error", text: `cat: ${arg}: No such file` }]); break; }
            if (file.type === "folder") { addLines(shellId, [{ type: "error", text: `cat: ${arg}: Is a directory` }]); break; }
            const content = file.content ?? "";
            const lineCount = content.split("\n").length;
            if (lineCount > 200) {
              addLines(shellId, [
                { type: "output", text: content.split("\n").slice(0, 50).join("\n") },
                { type: "info", text: `\n... (${lineCount} total lines — showing first 50. Use 'head' for less)` },
              ]);
            } else {
              addLines(shellId, [{ type: "output", text: content }]);
            }
            break;
          }

          case "head": {
            if (!arg) { addLines(shellId, [{ type: "error", text: "head: missing file operand" }]); break; }
            const headPath = cwd ? `${cwd}/${arg}` : arg;
            const headFile = await db.files.get(headPath);
            if (!headFile) { addLines(shellId, [{ type: "error", text: `head: ${arg}: No such file` }]); break; }
            const headContent = (headFile.content ?? "").split("\n").slice(0, 20).join("\n");
            addLines(shellId, [{ type: "output", text: headContent }]);
            break;
          }

          case "wc": {
            if (!arg) { addLines(shellId, [{ type: "error", text: "wc: missing file operand" }]); break; }
            const wcPath = cwd ? `${cwd}/${arg}` : arg;
            const wcFile = await db.files.get(wcPath);
            if (!wcFile) { addLines(shellId, [{ type: "error", text: `wc: ${arg}: No such file` }]); break; }
            const wcLines = (wcFile.content ?? "").split("\n").length;
            const wcChars = (wcFile.content ?? "").length;
            addLines(shellId, [{ type: "output", text: `  ${wcLines} lines  ${wcChars} chars  ${arg}` }]);
            break;
          }

          case "find": {
            if (!arg) { addLines(shellId, [{ type: "error", text: "find: missing pattern" }]); break; }
            const allFiles = await db.files.where("type").equals("file").toArray();
            const matches = allFiles
              .filter((f) => f.name.toLowerCase().includes(arg.toLowerCase()))
              .slice(0, 25);
            if (matches.length === 0) {
              addLines(shellId, [{ type: "output", text: "No files found." }]);
            } else {
              addLines(shellId, matches.map((f) => ({ type: "output" as const, text: f.id })));
            }
            break;
          }

          case "grep": {
            const grepParts = arg.match(/^"([^"]+)"\s+(.+)$/) || arg.match(/^(\S+)\s+(.+)$/);
            if (!grepParts) {
              addLines(shellId, [{ type: "error", text: 'grep: usage: grep <pattern> <file>' }]);
              break;
            }
            const grepQuery = grepParts[1];
            const grepFilePath = cwd ? `${cwd}/${grepParts[2]}` : grepParts[2];
            const grepFile = await db.files.get(grepFilePath);
            if (!grepFile) { addLines(shellId, [{ type: "error", text: `grep: ${grepParts[2]}: No such file` }]); break; }
            const grepLines = (grepFile.content ?? "").split("\n");
            const grepMatches: string[] = [];
            grepLines.forEach((line, i) => {
              if (line.toLowerCase().includes(grepQuery.toLowerCase())) {
                grepMatches.push(`${i + 1}: ${line}`);
              }
            });
            if (grepMatches.length === 0) {
              addLines(shellId, [{ type: "output", text: "(no matches)" }]);
            } else {
              addLines(shellId, grepMatches.slice(0, 30).map((m) => ({ type: "output" as const, text: m })));
              if (grepMatches.length > 30) {
                addLines(shellId, [{ type: "info", text: `... ${grepMatches.length - 30} more matches` }]);
              }
            }
            break;
          }

          case "touch": {
            if (!arg) { addLines(shellId, [{ type: "error", text: "touch: missing file operand" }]); break; }
            const touchPath = cwd ? `${cwd}/${arg}` : arg;
            const existing = await db.files.get(touchPath);
            if (existing) {
              await db.files.update(touchPath, { updatedAt: new Date() });
              addLines(shellId, [{ type: "success", text: `touched: ${arg}` }]);
            } else {
              const ext = arg.split(".").pop()?.toLowerCase();
              const langMap: Record<string, string> = {
                tsx: "typescript", jsx: "typescript", ts: "typescript", js: "javascript",
                json: "json", md: "markdown", css: "css", html: "html",
              };
              await db.files.put({
                id: touchPath,
                name: arg.split("/").pop()!,
                type: "file",
                parentPath: cwd,
                language: langMap[ext ?? ""] ?? "plaintext",
                content: "",
                createdAt: new Date(),
                updatedAt: new Date(),
              });
              addLines(shellId, [{ type: "success", text: `created: ${touchPath}` }]);
            }
            break;
          }

          case "rm": {
            if (!arg) { addLines(shellId, [{ type: "error", text: "rm: missing operand" }]); break; }
            const rmPath = cwd ? `${cwd}/${arg}` : arg;
            const rmFile = await db.files.get(rmPath);
            if (!rmFile) { addLines(shellId, [{ type: "error", text: `rm: ${arg}: No such file` }]); break; }
            await db.files.delete(rmPath);
            addLines(shellId, [{ type: "success", text: `removed: ${rmPath}` }]);
            break;
          }

          case "mkdir": {
            if (!arg) { addLines(shellId, [{ type: "error", text: "mkdir: missing operand" }]); break; }
            const mkdirPath = cwd ? `${cwd}/${arg}` : arg;
            const mkdirExisting = await db.files.get(mkdirPath);
            if (mkdirExisting) { addLines(shellId, [{ type: "error", text: `mkdir: ${arg}: already exists` }]); break; }
            await db.files.put({
              id: mkdirPath,
              name: arg.split("/").pop()!,
              type: "folder",
              parentPath: cwd,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            addLines(shellId, [{ type: "success", text: `created directory: ${mkdirPath}` }]);
            break;
          }

          case "echo":
            addLines(shellId, [{ type: "output", text: arg }]);
            break;

          case "date":
            addLines(shellId, [{ type: "output", text: new Date().toString() }]);
            break;

          case "whoami":
            addLines(shellId, [{ type: "output", text: "developer@pipilot-ide" }]);
            break;

          default:
            addLines(shellId, [
              { type: "error", text: `bash: ${command}: command not found` },
            ]);
        }
      } catch (err) {
        addLines(shellId, [
          { type: "error", text: `Error: ${err instanceof Error ? err.message : "Unknown error"}` },
        ]);
      }
    },
    [activeShellId, shells, addLines, updateShell]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleCommand(input);
      setInput("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (activeShell && activeShell.history.length > 0) {
        const idx = activeShell.historyIndex === -1
          ? activeShell.history.length - 1
          : Math.max(0, activeShell.historyIndex - 1);
        updateShell(activeShellId, (s) => ({ ...s, historyIndex: idx }));
        setInput(activeShell.history[idx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (activeShell && activeShell.historyIndex !== -1) {
        const idx = activeShell.historyIndex + 1;
        if (idx >= activeShell.history.length) {
          updateShell(activeShellId, (s) => ({ ...s, historyIndex: -1 }));
          setInput("");
        } else {
          updateShell(activeShellId, (s) => ({ ...s, historyIndex: idx }));
          setInput(activeShell.history[idx]);
        }
      }
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      updateShell(activeShellId, (s) => ({ ...s, lines: [], nextLineId: 0 }));
    } else if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      setInput("");
      addLines(activeShellId, [{ type: "input", text: `${activeShell?.cwd || ""} $ ${input}^C` }]);
    }
  };

  const addShell = () => {
    shellCounter.current++;
    const id = `shell-${shellCounter.current}`;
    setShells((prev) => [...prev, createShell(id, shellCounter.current)]);
    setActiveShellId(id);
  };

  const removeShell = (id: string) => {
    if (shells.length <= 1) return;
    setShells((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeShellId === id) {
        setActiveShellId(next[next.length - 1].id);
      }
      return next;
    });
  };

  const prompt = activeShell?.cwd ? `${activeShell.cwd} $` : "$";

  const lineColor = (type: TerminalLine["type"]) => {
    switch (type) {
      case "error": return "hsl(0 84% 65%)";
      case "input": return "hsl(220 14% 55%)";
      case "info": return "hsl(207 90% 65%)";
      case "success": return "hsl(142 71% 60%)";
      default: return "hsl(220 14% 80%)";
    }
  };

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ height: 200, background: "hsl(220 13% 10%)" }}
    >
      {/* Tab bar */}
      <div
        className="flex items-center gap-0 border-b"
        style={{
          height: 28,
          minHeight: 28,
          background: "hsl(220 13% 13%)",
          borderColor: "hsl(220 13% 20%)",
        }}
      >
        {shells.map((shell) => (
          <button
            key={shell.id}
            className="flex items-center gap-1.5 px-3 text-xs transition-colors group"
            style={{
              height: "100%",
              color: activeShellId === shell.id ? "hsl(220 14% 90%)" : "hsl(220 14% 55%)",
              background: activeShellId === shell.id ? "hsl(220 13% 10%)" : "transparent",
              borderBottom: activeShellId === shell.id ? "1px solid hsl(207 90% 54%)" : "1px solid transparent",
            }}
            onClick={() => setActiveShellId(shell.id)}
          >
            <span className="font-mono">{shell.name}</span>
            {shells.length > 1 && (
              <span
                className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400"
                onClick={(e) => {
                  e.stopPropagation();
                  removeShell(shell.id);
                }}
              >
                <X size={10} />
              </span>
            )}
          </button>
        ))}

        <button
          className="flex items-center justify-center w-7 h-full transition-colors hover:bg-white/5"
          style={{ color: "hsl(220 14% 50%)" }}
          onClick={addShell}
          title="New Terminal"
        >
          <Plus size={13} />
        </button>

        <div className="flex-1" />

        <button
          className="flex items-center justify-center w-7 h-full transition-colors hover:bg-white/5"
          style={{ color: "hsl(220 14% 40%)" }}
          onClick={() => updateShell(activeShellId, (s) => ({ ...s, lines: [], nextLineId: 0 }))}
          title="Clear"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Terminal output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-5 cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {activeShell?.lines.map((line) => (
          <div
            key={line.id}
            className="whitespace-pre-wrap break-all"
            style={{ color: lineColor(line.type) }}
          >
            {line.text}
          </div>
        ))}

        {/* Input line */}
        <div className="flex items-center gap-1.5">
          <span style={{ color: "hsl(142 71% 60%)" }} className="flex-shrink-0 select-none">
            {prompt}
          </span>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent outline-none font-mono text-xs caret-white"
            style={{ color: "hsl(220 14% 92%)" }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>
    </div>
  );
}
