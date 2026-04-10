import { useState, useRef, useEffect, useCallback, KeyboardEvent } from "react";
import { Plus, X, Trash2, Monitor } from "lucide-react";
import { db } from "@/lib/db";
import { useActiveProject } from "@/contexts/ProjectContext";
import { XTerminal } from "@/components/ide/XTerminal";
import { RealTerminal } from "@/components/ide/RealTerminal";

interface TerminalLine {
  id: number;
  type: "input" | "output" | "error" | "info" | "success";
  text: string;
}

interface ShellTab {
  id: string;
  name: string;
  type: "virtual" | "node" | "real";
  lines: TerminalLine[];
  history: string[];
  historyIndex: number;
  cwd: string; // current working directory within the virtual workspace
  nextLineId: number;
}

function createNodeShell(id: string, index: number): ShellTab {
  return {
    id,
    name: `node ${index}`,
    type: "node",
    lines: [],
    history: [],
    historyIndex: -1,
    cwd: "",
    nextLineId: 0,
  };
}

function createRealShell(id: string, index: number): ShellTab {
  return {
    id,
    name: `shell ${index}`,
    type: "real",
    lines: [],
    history: [],
    historyIndex: -1,
    cwd: "",
    nextLineId: 0,
  };
}

function createShell(id: string, index: number): ShellTab {
  return {
    id,
    name: `bash ${index}`,
    type: "virtual",
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
  const { activeProjectId } = useActiveProject();
  const [shells, setShells] = useState<ShellTab[]>(() => [createRealShell("real-default-1", 1)]);
  const [activeShellId, setActiveShellId] = useState("real-default-1");
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

      // Helper: get file scoped to active project
      const getFile = async (path: string) => {
        const f = await db.files.get(path);
        return f && f.projectId === activeProjectId ? f : null;
      };

      // Helper: list files in directory scoped to project
      const listDir = async (parentPath: string) => {
        return db.files.where("parentPath").equals(parentPath).and(f => f.projectId === activeProjectId).toArray();
      };

      // Helper: get all project files
      const allFiles = async () => {
        return db.files.where("projectId").equals(activeProjectId).toArray();
      };

      // Add input line and update history
      addLines(shellId, [{ type: "input", text: `${prompt} ${cmd}` }]);
      updateShell(shellId, (s) => ({
        ...s,
        history: [...s.history, cmd],
        historyIndex: -1,
      }));

      // Special: echo ... > file  (write to file)
      const echoRedirect = cmd.trim().match(/^echo\s+(.*?)\s*>\s*(\S+)$/);
      if (echoRedirect) {
        const echoText = echoRedirect[1].replace(/^["']|["']$/g, "");
        const filePath = cwd ? `${cwd}/${echoRedirect[2]}` : echoRedirect[2];
        const ext = echoRedirect[2].split(".").pop()?.toLowerCase() ?? "";
        const langMap: Record<string, string> = { tsx: "typescript", jsx: "typescript", ts: "typescript", js: "javascript", json: "json", md: "markdown", css: "css", html: "html" };
        await db.files.put({
          id: filePath,
          name: echoRedirect[2].split("/").pop()!,
          type: "file",
          parentPath: filePath.includes("/") ? filePath.split("/").slice(0, -1).join("/") : cwd,
          language: langMap[ext] ?? "plaintext",
          content: echoText,
          projectId: activeProjectId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        addLines(shellId, [{ type: "success", text: `wrote: ${filePath}` }]);
        return;
      }

      // Special: echo ... >> file  (append to file)
      const echoAppend = cmd.trim().match(/^echo\s+(.*?)\s*>>\s*(\S+)$/);
      if (echoAppend) {
        const appendText = echoAppend[1].replace(/^["']|["']$/g, "");
        const filePath = cwd ? `${cwd}/${echoAppend[2]}` : echoAppend[2];
        const existing = await getFile(filePath);
        if (existing) {
          await db.files.update(filePath, { content: (existing.content ?? "") + "\n" + appendText, updatedAt: new Date() });
        } else {
          const ext = echoAppend[2].split(".").pop()?.toLowerCase() ?? "";
          const langMap: Record<string, string> = { tsx: "typescript", jsx: "typescript", ts: "typescript", js: "javascript", json: "json", md: "markdown", css: "css", html: "html" };
          await db.files.put({
            id: filePath, name: echoAppend[2].split("/").pop()!, type: "file",
            parentPath: filePath.includes("/") ? filePath.split("/").slice(0, -1).join("/") : cwd,
            language: langMap[ext] ?? "plaintext", content: appendText,
            projectId: activeProjectId, createdAt: new Date(), updatedAt: new Date(),
          });
        }
        addLines(shellId, [{ type: "success", text: `appended to: ${filePath}` }]);
        return;
      }

      // Handle && chaining
      if (cmd.includes("&&")) {
        const chainedCmds = cmd.split("&&").map(s => s.trim()).filter(Boolean);
        for (const chainCmd of chainedCmds) {
          await handleCommand(chainCmd);
        }
        return;
      }

      // Handle ; chaining
      if (cmd.includes(";")) {
        const chainedCmds = cmd.split(";").map(s => s.trim()).filter(Boolean);
        for (const chainCmd of chainedCmds) {
          await handleCommand(chainCmd);
        }
        return;
      }

      const parts = cmd.trim().split(/\s+/);
      const command = parts[0]?.toLowerCase();
      const arg = parts.slice(1).join(" ").trim();

      try {
        switch (command) {
          case "": break;

          case "help":
            addLines(shellId, [
              { type: "info", text: "Available commands:" },
              { type: "info", text: "\n── File Operations ──" },
              { type: "output", text: "  ls [path]            List files in directory" },
              { type: "output", text: "  cat <file>           Print file contents" },
              { type: "output", text: "  head [-n N] <file>   Print first N lines (default 20)" },
              { type: "output", text: "  tail [-n N] <file>   Print last N lines (default 20)" },
              { type: "output", text: "  wc <file>            Count lines, words, chars" },
              { type: "output", text: "  touch <file>         Create empty file" },
              { type: "output", text: "  rm [-r] <path>       Delete file or directory" },
              { type: "output", text: "  cp <src> <dest>      Copy file" },
              { type: "output", text: "  mv <src> <dest>      Move/rename file" },
              { type: "output", text: "  mkdir [-p] <dir>     Create directory" },
              { type: "info", text: "\n── Navigation ──" },
              { type: "output", text: "  cd <path>            Change directory" },
              { type: "output", text: "  pwd                  Print working directory" },
              { type: "output", text: "  tree [path]          Show directory tree" },
              { type: "info", text: "\n── Search ──" },
              { type: "output", text: "  find <pattern>       Search files by name" },
              { type: "output", text: "  grep <q> <file>      Search content in file" },
              { type: "output", text: "  grep -r <q> [path]   Search content recursively" },
              { type: "info", text: "\n── Info & Utils ──" },
              { type: "output", text: "  stat <file>          Show file details" },
              { type: "output", text: "  du [path]            Show disk usage (sizes)" },
              { type: "output", text: "  diff <f1> <f2>       Compare two files" },
              { type: "output", text: "  echo <text>          Print text" },
              { type: "output", text: "  env                  Show environment info" },
              { type: "output", text: "  date                 Show date/time" },
              { type: "output", text: "  whoami               Show current user" },
              { type: "output", text: "  history              Show command history" },
              { type: "output", text: "  clear                Clear terminal" },
              { type: "output", text: "  export <K>=<V>       Set environment variable" },
              { type: "output", text: "  xargs <cmd>          Pipe input to command" },
              { type: "info", text: "\n── File Writing ──" },
              { type: "output", text: '  echo "text" > file     Write text to file' },
              { type: "output", text: '  echo "text" >> file    Append text to file' },
              { type: "output", text: "  write <file> <text>    Write content to file" },
              { type: "info", text: "\n── Text Processing ──" },
              { type: "output", text: "  sort <file>            Sort file lines" },
              { type: "output", text: "  uniq <file>            Remove adjacent duplicates" },
              { type: "output", text: "  man <cmd>              Show command manual" },
              { type: "info", text: "\n── Chaining & Redirection ──" },
              { type: "output", text: "  cmd1 && cmd2           Run cmd2 if cmd1 succeeds" },
              { type: "output", text: "  cmd1 ; cmd2            Run commands sequentially" },
              { type: "output", text: "  Tab                    Autocomplete file/folder names" },
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
            const dir = await getFile(targetPath);
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
            const items = await listDir(parentPath);
            if (items.length === 0 && lsPath) {
              const exists = await getFile(lsPath);
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
            const file = await getFile(catPath);
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
            let headN = 20;
            let headArg = arg;
            const headNMatch = arg.match(/^-n\s+(\d+)\s+(.+)$/);
            if (headNMatch) { headN = parseInt(headNMatch[1]); headArg = headNMatch[2]; }
            else if (arg.match(/^-(\d+)\s+(.+)$/)) { const m = arg.match(/^-(\d+)\s+(.+)$/)!; headN = parseInt(m[1]); headArg = m[2]; }
            if (!headArg) { addLines(shellId, [{ type: "error", text: "head: missing file operand" }]); break; }
            const headPath = cwd ? `${cwd}/${headArg}` : headArg;
            const headFile = await getFile(headPath);
            if (!headFile) { addLines(shellId, [{ type: "error", text: `head: ${headArg}: No such file` }]); break; }
            const headContent = (headFile.content ?? "").split("\n").slice(0, headN).join("\n");
            addLines(shellId, [{ type: "output", text: headContent }]);
            break;
          }

          case "tail": {
            let tailN = 20;
            let tailArg = arg;
            const tailNMatch = arg.match(/^-n\s+(\d+)\s+(.+)$/);
            if (tailNMatch) { tailN = parseInt(tailNMatch[1]); tailArg = tailNMatch[2]; }
            else if (arg.match(/^-(\d+)\s+(.+)$/)) { const m = arg.match(/^-(\d+)\s+(.+)$/)!; tailN = parseInt(m[1]); tailArg = m[2]; }
            if (!tailArg) { addLines(shellId, [{ type: "error", text: "tail: missing file operand" }]); break; }
            const tailPath = cwd ? `${cwd}/${tailArg}` : tailArg;
            const tailFile = await getFile(tailPath);
            if (!tailFile) { addLines(shellId, [{ type: "error", text: `tail: ${tailArg}: No such file` }]); break; }
            const tailLines = (tailFile.content ?? "").split("\n");
            const tailContent = tailLines.slice(-tailN).join("\n");
            addLines(shellId, [{ type: "output", text: tailContent }]);
            break;
          }

          case "wc": {
            if (!arg) { addLines(shellId, [{ type: "error", text: "wc: missing file operand" }]); break; }
            const wcPath = cwd ? `${cwd}/${arg}` : arg;
            const wcFile = await getFile(wcPath);
            if (!wcFile) { addLines(shellId, [{ type: "error", text: `wc: ${arg}: No such file` }]); break; }
            const wcLines = (wcFile.content ?? "").split("\n").length;
            const wcChars = (wcFile.content ?? "").length;
            addLines(shellId, [{ type: "output", text: `  ${wcLines} lines  ${wcChars} chars  ${arg}` }]);
            break;
          }

          case "find": {
            if (!arg) { addLines(shellId, [{ type: "error", text: "find: missing pattern" }]); break; }
            const findAllFiles = (await allFiles()).filter(f => f.type === "file");
            const matches = findAllFiles
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
            // Support grep -r <pattern> [path] for recursive search
            const isRecursive = arg.startsWith("-r ") || arg.startsWith("-ri ");
            const grepArg = isRecursive ? arg.replace(/^-ri?\s+/, "") : arg;

            if (isRecursive) {
              const rGrepParts = grepArg.match(/^"([^"]+)"(?:\s+(.+))?$/) || grepArg.match(/^(\S+)(?:\s+(.+))?$/);
              if (!rGrepParts) { addLines(shellId, [{ type: "error", text: 'grep -r: usage: grep -r <pattern> [path]' }]); break; }
              const rQuery = rGrepParts[1];
              const rBasePath = rGrepParts[2] ? (cwd ? `${cwd}/${rGrepParts[2]}` : rGrepParts[2]) : cwd || "";
              const allGrepFiles = (await allFiles()).filter(f => f.type === "file");
              const filteredFiles = rBasePath
                ? allGrepFiles.filter((f) => f.id.startsWith(rBasePath))
                : allGrepFiles;
              const rMatches: string[] = [];
              for (const f of filteredFiles) {
                const fLines = (f.content ?? "").split("\n");
                fLines.forEach((line, i) => {
                  if (line.toLowerCase().includes(rQuery.toLowerCase())) {
                    rMatches.push(`${f.id}:${i + 1}: ${line.trim()}`);
                  }
                });
                if (rMatches.length > 50) break;
              }
              if (rMatches.length === 0) {
                addLines(shellId, [{ type: "output", text: "(no matches)" }]);
              } else {
                addLines(shellId, rMatches.slice(0, 50).map((m) => ({ type: "output" as const, text: m })));
                if (rMatches.length > 50) addLines(shellId, [{ type: "info", text: `... more matches (showing first 50)` }]);
              }
              break;
            }

            const grepParts = grepArg.match(/^"([^"]+)"\s+(.+)$/) || grepArg.match(/^(\S+)\s+(.+)$/);
            if (!grepParts) {
              addLines(shellId, [{ type: "error", text: 'grep: usage: grep <pattern> <file> or grep -r <pattern> [path]' }]);
              break;
            }
            const grepQuery = grepParts[1];
            const grepFilePath = cwd ? `${cwd}/${grepParts[2]}` : grepParts[2];
            const grepFile = await getFile(grepFilePath);
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
            const touchExisting = await getFile(touchPath);
            if (touchExisting) {
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
                projectId: activeProjectId,
                createdAt: new Date(),
                updatedAt: new Date(),
              });
              addLines(shellId, [{ type: "success", text: `created: ${touchPath}` }]);
            }
            break;
          }

          case "rm": {
            if (!arg) { addLines(shellId, [{ type: "error", text: "rm: missing operand" }]); break; }
            const rmRecursive = arg.startsWith("-r ") || arg.startsWith("-rf ") || arg.startsWith("-fr ");
            const rmTarget = rmRecursive ? arg.replace(/^-r[f]?\s+|-fr\s+/, "") : arg;
            const rmPath = cwd ? `${cwd}/${rmTarget}` : rmTarget;
            const rmFile = await getFile(rmPath);
            if (!rmFile) { addLines(shellId, [{ type: "error", text: `rm: ${rmTarget}: No such file or directory` }]); break; }
            if (rmFile.type === "folder" && !rmRecursive) {
              addLines(shellId, [{ type: "error", text: `rm: ${rmTarget}: Is a directory (use rm -r)` }]); break;
            }
            if (rmFile.type === "folder") {
              // Recursive delete
              const rmChildren = await allFiles();
              const toDelete = rmChildren.filter((f) => f.id === rmPath || f.id.startsWith(rmPath + "/"));
              for (const f of toDelete) await db.files.delete(f.id);
              addLines(shellId, [{ type: "success", text: `removed: ${rmPath} (${toDelete.length} items)` }]);
            } else {
              await db.files.delete(rmPath);
              addLines(shellId, [{ type: "success", text: `removed: ${rmPath}` }]);
            }
            break;
          }

          case "mkdir": {
            if (!arg) { addLines(shellId, [{ type: "error", text: "mkdir: missing operand" }]); break; }
            const mkdirPath = cwd ? `${cwd}/${arg}` : arg;
            const mkdirExisting = await getFile(mkdirPath);
            if (mkdirExisting) { addLines(shellId, [{ type: "error", text: `mkdir: ${arg}: already exists` }]); break; }
            await db.files.put({
              id: mkdirPath,
              name: arg.split("/").pop()!,
              type: "folder",
              parentPath: cwd,
              projectId: activeProjectId,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            addLines(shellId, [{ type: "success", text: `created directory: ${mkdirPath}` }]);
            break;
          }

          case "cp": {
            const cpMatch = arg.match(/^(\S+)\s+(\S+)$/);
            if (!cpMatch) { addLines(shellId, [{ type: "error", text: "cp: usage: cp <source> <destination>" }]); break; }
            const cpSrc = cwd ? `${cwd}/${cpMatch[1]}` : cpMatch[1];
            const cpDest = cwd ? `${cwd}/${cpMatch[2]}` : cpMatch[2];
            const cpFile = await getFile(cpSrc);
            if (!cpFile) { addLines(shellId, [{ type: "error", text: `cp: ${cpMatch[1]}: No such file` }]); break; }
            if (cpFile.type === "folder") { addLines(shellId, [{ type: "error", text: `cp: ${cpMatch[1]}: Is a directory (use cp -r)` }]); break; }
            const cpExt = cpMatch[2].split(".").pop()?.toLowerCase();
            const cpLangMap: Record<string, string> = { tsx: "typescript", jsx: "typescript", ts: "typescript", js: "javascript", json: "json", md: "markdown", css: "css", html: "html" };
            await db.files.put({
              id: cpDest, name: cpMatch[2].split("/").pop()!, type: "file",
              parentPath: cpDest.includes("/") ? cpDest.split("/").slice(0, -1).join("/") : cwd,
              language: cpLangMap[cpExt ?? ""] ?? cpFile.language ?? "plaintext",
              content: cpFile.content ?? "", projectId: activeProjectId, createdAt: new Date(), updatedAt: new Date(),
            });
            addLines(shellId, [{ type: "success", text: `copied: ${cpSrc} → ${cpDest}` }]);
            break;
          }

          case "mv": {
            const mvMatch = arg.match(/^(\S+)\s+(\S+)$/);
            if (!mvMatch) { addLines(shellId, [{ type: "error", text: "mv: usage: mv <source> <destination>" }]); break; }
            const mvSrc = cwd ? `${cwd}/${mvMatch[1]}` : mvMatch[1];
            const mvDest = cwd ? `${cwd}/${mvMatch[2]}` : mvMatch[2];
            const mvFile = await getFile(mvSrc);
            if (!mvFile) { addLines(shellId, [{ type: "error", text: `mv: ${mvMatch[1]}: No such file` }]); break; }
            await db.files.put({
              ...mvFile, id: mvDest, name: mvMatch[2].split("/").pop()!,
              parentPath: mvDest.includes("/") ? mvDest.split("/").slice(0, -1).join("/") : cwd,
              projectId: activeProjectId, updatedAt: new Date(),
            });
            await db.files.delete(mvSrc);
            addLines(shellId, [{ type: "success", text: `moved: ${mvSrc} → ${mvDest}` }]);
            break;
          }

          case "tree": {
            const treePath = arg ? (cwd ? `${cwd}/${arg}` : arg) : cwd || "";
            const treeAllFiles = await allFiles();
            const treeLines: string[] = [];

            function buildTreeOutput(parentPath: string, prefix: string) {
              const children = treeAllFiles
                .filter((f) => f.parentPath === parentPath)
                .sort((a, b) => {
                  if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
                  return a.name.localeCompare(b.name);
                });
              children.forEach((child, idx) => {
                const isLast = idx === children.length - 1;
                const connector = isLast ? "└── " : "├── ";
                const suffix = child.type === "folder" ? "/" : "";
                treeLines.push(`${prefix}${connector}${child.name}${suffix}`);
                if (child.type === "folder") {
                  buildTreeOutput(child.id, prefix + (isLast ? "    " : "│   "));
                }
              });
            }

            treeLines.push(treePath || ".");
            buildTreeOutput(treePath, "");
            const dirs = treeAllFiles.filter((f) => f.parentPath === treePath || f.id.startsWith(treePath ? treePath + "/" : "")).filter((f) => f.type === "folder").length;
            const files = treeAllFiles.filter((f) => f.parentPath === treePath || f.id.startsWith(treePath ? treePath + "/" : "")).filter((f) => f.type === "file").length;
            treeLines.push(`\n${dirs} directories, ${files} files`);
            addLines(shellId, [{ type: "output", text: treeLines.join("\n") }]);
            break;
          }

          case "stat": {
            if (!arg) { addLines(shellId, [{ type: "error", text: "stat: missing file operand" }]); break; }
            const statPath = cwd ? `${cwd}/${arg}` : arg;
            const statFile = await getFile(statPath);
            if (!statFile) { addLines(shellId, [{ type: "error", text: `stat: ${arg}: No such file` }]); break; }
            const statLines = statFile.content ? statFile.content.split("\n").length : 0;
            const statSize = statFile.content ? statFile.content.length : 0;
            addLines(shellId, [
              { type: "output", text: `  File: ${statFile.name}` },
              { type: "output", text: `  Type: ${statFile.type}` },
              { type: "output", text: `  Language: ${statFile.language || "N/A"}` },
              { type: "output", text: `  Size: ${statSize} bytes (${statLines} lines)` },
              { type: "output", text: `  Created: ${statFile.createdAt}` },
              { type: "output", text: `  Modified: ${statFile.updatedAt}` },
            ]);
            break;
          }

          case "du": {
            const duPath = arg ? (cwd ? `${cwd}/${arg}` : arg) : cwd || "";
            const duAllFiles = (await allFiles()).filter(f => f.type === "file");
            const duFiltered = duPath
              ? duAllFiles.filter((f) => f.id.startsWith(duPath))
              : duAllFiles;
            const totalSize = duFiltered.reduce((sum, f) => sum + (f.content?.length ?? 0), 0);
            const sizeStr = totalSize > 1024 ? `${(totalSize / 1024).toFixed(1)}KB` : `${totalSize}B`;
            addLines(shellId, [
              { type: "output", text: `${sizeStr}\t${duPath || "."} (${duFiltered.length} files)` },
            ]);
            break;
          }

          case "diff": {
            const diffMatch = arg.match(/^(\S+)\s+(\S+)$/);
            if (!diffMatch) { addLines(shellId, [{ type: "error", text: "diff: usage: diff <file1> <file2>" }]); break; }
            const diffPath1 = cwd ? `${cwd}/${diffMatch[1]}` : diffMatch[1];
            const diffPath2 = cwd ? `${cwd}/${diffMatch[2]}` : diffMatch[2];
            const diffFile1 = await getFile(diffPath1);
            const diffFile2 = await getFile(diffPath2);
            if (!diffFile1) { addLines(shellId, [{ type: "error", text: `diff: ${diffMatch[1]}: No such file` }]); break; }
            if (!diffFile2) { addLines(shellId, [{ type: "error", text: `diff: ${diffMatch[2]}: No such file` }]); break; }
            const lines1 = (diffFile1.content ?? "").split("\n");
            const lines2 = (diffFile2.content ?? "").split("\n");
            const maxLen = Math.max(lines1.length, lines2.length);
            const diffOutput: { type: "output" | "error" | "success"; text: string }[] = [];
            let hasDiff = false;
            for (let i = 0; i < maxLen; i++) {
              if (lines1[i] !== lines2[i]) {
                hasDiff = true;
                if (lines1[i] !== undefined) diffOutput.push({ type: "error", text: `- ${i + 1}: ${lines1[i]}` });
                if (lines2[i] !== undefined) diffOutput.push({ type: "success", text: `+ ${i + 1}: ${lines2[i]}` });
              }
            }
            if (!hasDiff) {
              addLines(shellId, [{ type: "info", text: "Files are identical." }]);
            } else {
              addLines(shellId, diffOutput.slice(0, 60));
              if (diffOutput.length > 60) addLines(shellId, [{ type: "info", text: `... ${diffOutput.length - 60} more diff lines` }]);
            }
            break;
          }

          case "env": {
            const envVars = (shell as ShellTab & { env?: Record<string, string> }).env || {};
            addLines(shellId, [
              { type: "output", text: `SHELL=/bin/bash` },
              { type: "output", text: `USER=developer` },
              { type: "output", text: `HOME=/workspace` },
              { type: "output", text: `PWD=/${cwd || ""}` },
              { type: "output", text: `TERM=xterm-256color` },
              { type: "output", text: `EDITOR=pipilot-ide` },
              { type: "output", text: `NODE_ENV=development` },
              ...Object.entries(envVars).map(([k, v]) => ({ type: "output" as const, text: `${k}=${v}` })),
            ]);
            break;
          }

          case "export": {
            const exportMatch = arg.match(/^(\w+)=(.*)$/);
            if (!exportMatch) { addLines(shellId, [{ type: "error", text: "export: usage: export KEY=VALUE" }]); break; }
            updateShell(shellId, (s) => {
              const env = (s as ShellTab & { env?: Record<string, string> }).env || {};
              env[exportMatch[1]] = exportMatch[2];
              return { ...s, env } as ShellTab;
            });
            addLines(shellId, [{ type: "success", text: `${exportMatch[1]}=${exportMatch[2]}` }]);
            break;
          }

          case "history": {
            if (shell.history.length === 0) {
              addLines(shellId, [{ type: "output", text: "(no history)" }]);
            } else {
              addLines(shellId, shell.history.map((h, i) => ({
                type: "output" as const,
                text: `  ${i + 1}  ${h}`,
              })));
            }
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

          case "uname":
            addLines(shellId, [{ type: "output", text: "PiPilot IDE v2.0 — Browser-based Virtual Workspace" }]);
            break;

          case "uptime":
            addLines(shellId, [{ type: "output", text: `up ${Math.floor(performance.now() / 60000)} minutes` }]);
            break;

          case "which":
            if (!arg) { addLines(shellId, [{ type: "error", text: "which: missing argument" }]); break; }
            const knownCmds = ["ls","cd","cat","head","tail","wc","find","grep","touch","rm","cp","mv","mkdir","tree","stat","du","diff","echo","date","whoami","env","export","history","clear","pwd","uname","uptime","which","help","sort","uniq","man","write","tee"];
            if (knownCmds.includes(arg)) {
              addLines(shellId, [{ type: "output", text: `/usr/bin/${arg}` }]);
            } else {
              addLines(shellId, [{ type: "error", text: `${arg} not found` }]);
            }
            break;

          case "sort": {
            if (!arg) { addLines(shellId, [{ type: "error", text: "sort: missing file operand" }]); break; }
            const sortPath = cwd ? `${cwd}/${arg}` : arg;
            const sortFile = await getFile(sortPath);
            if (!sortFile) { addLines(shellId, [{ type: "error", text: `sort: ${arg}: No such file` }]); break; }
            const sorted = (sortFile.content ?? "").split("\n").sort().join("\n");
            addLines(shellId, [{ type: "output", text: sorted }]);
            break;
          }

          case "uniq": {
            if (!arg) { addLines(shellId, [{ type: "error", text: "uniq: missing file operand" }]); break; }
            const uniqPath = cwd ? `${cwd}/${arg}` : arg;
            const uniqFile = await getFile(uniqPath);
            if (!uniqFile) { addLines(shellId, [{ type: "error", text: `uniq: ${arg}: No such file` }]); break; }
            const uniqued = (uniqFile.content ?? "").split("\n").filter((line, i, arr) => i === 0 || line !== arr[i - 1]).join("\n");
            addLines(shellId, [{ type: "output", text: uniqued }]);
            break;
          }

          case "man": {
            if (!arg) { addLines(shellId, [{ type: "info", text: "What manual page do you want? Try: man ls" }]); break; }
            const manPages: Record<string, string> = {
              ls: "ls [path] — List directory contents. Files sorted alphabetically, folders first.",
              cd: "cd <path> — Change working directory. Use 'cd ..' for parent, 'cd /' for root.",
              cat: "cat <file> — Print file contents to terminal. Truncates at 200 lines.",
              grep: "grep <pattern> <file> — Search content in file.\ngrep -r <pattern> [path] — Search recursively.",
              find: "find <pattern> — Search files by name pattern.",
              rm: "rm <file> — Delete file. rm -r <dir> — Delete directory recursively.",
              cp: "cp <src> <dest> — Copy a file to a new location.",
              mv: "mv <src> <dest> — Move/rename a file.",
              mkdir: "mkdir <dir> — Create a new directory.",
              touch: "touch <file> — Create an empty file or update timestamp.",
              tree: "tree [path] — Display directory tree structure.",
              stat: "stat <file> — Show detailed file information.",
              diff: "diff <f1> <f2> — Compare two files line by line.",
              echo: "echo <text> — Print text. Supports > file and >> file for redirection.",
              sort: "sort <file> — Sort file lines alphabetically.",
              uniq: "uniq <file> — Remove adjacent duplicate lines.",
              write: "write <file> <content> — Write content to file.",
            };
            const manText = manPages[arg];
            if (manText) {
              addLines(shellId, [{ type: "info", text: `Manual: ${arg}\n${manText}` }]);
            } else {
              addLines(shellId, [{ type: "error", text: `No manual entry for ${arg}` }]);
            }
            break;
          }

          case "write": {
            // write <file> <content> — write content to file
            const writeMatch = arg.match(/^(\S+)\s+([\s\S]+)$/);
            if (!writeMatch) { addLines(shellId, [{ type: "error", text: "write: usage: write <file> <content>" }]); break; }
            const writePath = cwd ? `${cwd}/${writeMatch[1]}` : writeMatch[1];
            const writeContent = writeMatch[2].replace(/^["']|["']$/g, "");
            const writeExt = writeMatch[1].split(".").pop()?.toLowerCase() ?? "";
            const writeLangMap: Record<string, string> = { tsx: "typescript", jsx: "typescript", ts: "typescript", js: "javascript", json: "json", md: "markdown", css: "css", html: "html" };
            await db.files.put({
              id: writePath, name: writeMatch[1].split("/").pop()!, type: "file",
              parentPath: writePath.includes("/") ? writePath.split("/").slice(0, -1).join("/") : cwd,
              language: writeLangMap[writeExt] ?? "plaintext", content: writeContent,
              projectId: activeProjectId, createdAt: new Date(), updatedAt: new Date(),
            });
            addLines(shellId, [{ type: "success", text: `wrote ${writeContent.length} chars to ${writePath}` }]);
            break;
          }

          case "cat_write":
          case "tee": {
            addLines(shellId, [{ type: "info", text: "tee: Use 'echo text > file' or 'write file content' for file writing" }]);
            break;
          }

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
    [activeShellId, shells, addLines, updateShell, activeProjectId]
  );

  const handleKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleCommand(input);
      setInput("");
    } else if (e.key === "Tab") {
      e.preventDefault();
      // Tab complete file/folder names
      const currentInput = input;
      const inputParts = currentInput.split(/\s+/);
      const lastPart = inputParts[inputParts.length - 1] || "";

      // Determine the directory to search in
      let searchDir = activeShell?.cwd || "";
      let prefix = lastPart;
      if (lastPart.includes("/")) {
        const pathParts = lastPart.split("/");
        prefix = pathParts.pop() || "";
        const dirPart = pathParts.join("/");
        searchDir = searchDir ? `${searchDir}/${dirPart}` : dirPart;
      }

      // Find matching files
      const dirFiles = await db.files.where("parentPath").equals(searchDir)
        .and(f => f.projectId === activeProjectId)
        .toArray();
      const matches = dirFiles.filter(f => f.name.toLowerCase().startsWith(prefix.toLowerCase()));

      if (matches.length === 1) {
        const completion = matches[0].name + (matches[0].type === "folder" ? "/" : "");
        inputParts[inputParts.length - 1] = lastPart.includes("/")
          ? lastPart.split("/").slice(0, -1).join("/") + "/" + completion
          : completion;
        setInput(inputParts.join(" "));
      } else if (matches.length > 1) {
        // Show all matches
        addLines(activeShellId, [{
          type: "info",
          text: matches.map(f => f.name + (f.type === "folder" ? "/" : "")).join("  ")
        }]);
      }
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

  const [showNewMenu, setShowNewMenu] = useState(false);
  const nodeCounter = useRef(0);
  const realCounter = useRef(0);

  const addShell = () => {
    shellCounter.current++;
    const id = `shell-${shellCounter.current}`;
    setShells((prev) => [...prev, createShell(id, shellCounter.current)]);
    setActiveShellId(id);
  };

  const addNodeShell = () => {
    nodeCounter.current++;
    const id = `node-${nodeCounter.current}`;
    setShells((prev) => [...prev, createNodeShell(id, nodeCounter.current)]);
    setActiveShellId(id);
  };

  const addRealShell = (initialCommand?: string) => {
    realCounter.current++;
    const id = `real-${Date.now()}-${realCounter.current}`;
    setShells((prev) => [...prev, createRealShell(id, realCounter.current)]);
    setActiveShellId(id);
    // If a command is provided, run it after the shell connects
    if (initialCommand) {
      setTimeout(async () => {
        try {
          await fetch("/api/terminal/write", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: id, data: initialCommand + "\r" }),
          });
        } catch {}
      }, 800);
    }
    return id;
  };

  // Listen for global "run-in-terminal" events from RunDebugPanel
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      addRealShell(detail?.command || undefined);
    };
    window.addEventListener("pipilot:run-in-terminal", handler);
    return () => window.removeEventListener("pipilot:run-in-terminal", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showNewMenu) return;
    const handle = (e: MouseEvent) => setShowNewMenu(false);
    document.addEventListener("click", handle);
    return () => document.removeEventListener("click", handle);
  }, [showNewMenu]);

  const removeShell = (id: string) => {
    if (shells.length <= 1) return;
    // Destroy PTY if it's a real shell
    const shell = shells.find(s => s.id === id);
    if (shell?.type === "real") {
      fetch("/api/terminal/destroy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      }).catch(() => {});
    }
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
      className="flex flex-col"
      style={{ height: "100%", background: "hsl(220 13% 10%)", overflow: "hidden" }}
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

        <div style={{ position: "relative" }}>
          <button
            className="flex items-center justify-center w-7 h-full transition-colors hover:bg-white/5"
            style={{ color: "hsl(220 14% 50%)" }}
            onClick={(e) => { e.stopPropagation(); setShowNewMenu(!showNewMenu); }}
            title="New Terminal"
          >
            <Plus size={13} />
          </button>
          {showNewMenu && (
            <div style={{
              position: "absolute", top: "100%", left: 0, zIndex: 100,
              background: "hsl(220 13% 18%)", border: "1px solid hsl(220 13% 25%)",
              borderRadius: 6, padding: 4, minWidth: 160,
              boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            }}>
              <button
                onClick={() => { addShell(); setShowNewMenu(false); }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "6px 10px", fontSize: 11, color: "hsl(220 14% 80%)",
                  background: "transparent", border: "none", cursor: "pointer",
                  borderRadius: 4,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "hsl(220 13% 25%)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                Virtual Shell (file ops)
              </button>
              <button
                onClick={() => { addNodeShell(); setShowNewMenu(false); }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "6px 10px", fontSize: 11, color: "hsl(142 71% 60%)",
                  background: "transparent", border: "none", cursor: "pointer",
                  borderRadius: 4,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "hsl(220 13% 25%)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                Node.js Terminal (run JS files)
              </button>
              <button
                onClick={() => { addRealShell(); setShowNewMenu(false); }}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "6px 10px", fontSize: 11, color: "hsl(207 90% 65%)",
                  background: "transparent", border: "none", cursor: "pointer",
                  borderRadius: 4,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "hsl(220 13% 25%)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                System Shell (real terminal)
              </button>
            </div>
          )}
        </div>

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
      {activeShell?.type === "real" ? (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <RealTerminal
            sessionId={activeShell.id}
            projectId={activeProjectId}
            onExit={() => {
              // Mark as exited but keep the tab
            }}
          />
        </div>
      ) : activeShell?.type === "node" ? (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <XTerminal />
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="px-3 py-2 font-mono text-xs leading-5 cursor-text"
          style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
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
      )}
    </div>
  );
}
