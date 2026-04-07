import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { getNodebox, syncFilesToNodebox } from "@/lib/nodebox";
import { useActiveProject } from "@/contexts/ProjectContext";
import type { Nodebox, ShellProcess } from "@codesandbox/nodebox";

interface XTerminalProps {
  onReady?: () => void;
}

export function XTerminal({ onReady }: XTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<"booting" | "syncing" | "ready" | "error">("booting");
  const { activeProjectId } = useActiveProject();
  const nodeboxRef = useRef<Nodebox | null>(null);
  const shellRef = useRef<ShellProcess | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const inputBufRef = useRef("");
  const runningRef = useRef(false);

  // Initialize xterm
  useEffect(() => {
    if (!termRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Fira Code", "Cascadia Code", "JetBrains Mono", monospace',
      theme: {
        background: "#1a1d23",
        foreground: "#c8ccd4",
        cursor: "#528bff",
        selectionBackground: "#3e4451",
        black: "#1a1d23",
        red: "#e06c75",
        green: "#98c379",
        yellow: "#e5c07b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#56b6c2",
        white: "#c8ccd4",
        brightBlack: "#5c6370",
        brightRed: "#e06c75",
        brightGreen: "#98c379",
        brightYellow: "#e5c07b",
        brightBlue: "#61afef",
        brightMagenta: "#c678dd",
        brightCyan: "#56b6c2",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(termRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {}
    });
    resizeObserver.observe(termRef.current);

    term.writeln("\x1b[1;34m╭──────────────────────────────────────╮\x1b[0m");
    term.writeln("\x1b[1;34m│\x1b[0m  \x1b[1;36mPiPilot Node.js Terminal\x1b[0m           \x1b[1;34m│\x1b[0m");
    term.writeln("\x1b[1;34m│\x1b[0m  Powered by Sandpack Nodebox         \x1b[1;34m│\x1b[0m");
    term.writeln("\x1b[1;34m│\x1b[0m  Run: node file.js, ls, cat, etc.    \x1b[1;34m│\x1b[0m");
    term.writeln("\x1b[1;34m╰──────────────────────────────────────╯\x1b[0m");
    term.writeln("");

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
    };
  }, []);

  // Boot Nodebox
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;

    let disposed = false;

    async function boot() {
      try {
        setStatus("booting");
        term.writeln("\x1b[33mBooting Nodebox runtime...\x1b[0m");

        const nodebox = await getNodebox();
        if (disposed) return;
        nodeboxRef.current = nodebox;

        // Sync project files
        setStatus("syncing");
        term.writeln("\x1b[33mSyncing project files...\x1b[0m");
        const count = await syncFilesToNodebox(nodebox, activeProjectId);
        if (disposed) return;

        term.writeln(`\x1b[32m✓ ${count} files synced\x1b[0m`);
        term.writeln("");
        term.writeln(
          "\x1b[2mType commands: node file.js, npm init, ls, cat, etc.\x1b[0m"
        );
        term.writeln("");

        setStatus("ready");
        onReady?.();
        printPrompt(term);

        // Handle user input
        term.onData((data) => {
          if (disposed) return;

          // If a command is currently running, forward input as stdin
          if (runningRef.current && shellRef.current) {
            shellRef.current.stdin.write(data);
            return;
          }

          handleInput(term, nodebox, data);
        });
      } catch (err: any) {
        if (disposed) return;
        const msg = err?.message || String(err);
        setStatus("error");
        term.writeln(`\n\x1b[1;31mFailed to boot Nodebox:\x1b[0m`);
        term.writeln(`\x1b[31m${msg}\x1b[0m`);
        term.writeln("");
        term.writeln("\x1b[32mUse the Virtual Shell tab for file operations.\x1b[0m");
      }
    }

    boot();

    return () => {
      disposed = true;
    };
  }, [activeProjectId, onReady]);

  const printPrompt = useCallback((term: Terminal) => {
    term.write("\x1b[32m❯\x1b[0m ");
    inputBufRef.current = "";
  }, []);

  const handleInput = useCallback(
    (term: Terminal, nodebox: Nodebox, data: string) => {
      // Enter — execute command
      if (data === "\r") {
        term.writeln("");
        const cmd = inputBufRef.current.trim();
        if (cmd) {
          historyRef.current.push(cmd);
          historyIdxRef.current = -1;
          executeCommand(term, nodebox, cmd);
        } else {
          printPrompt(term);
        }
        return;
      }

      // Backspace
      if (data === "\x7f" || data.charCodeAt(0) === 8) {
        if (inputBufRef.current.length > 0) {
          inputBufRef.current = inputBufRef.current.slice(0, -1);
          term.write("\b \b");
        }
        return;
      }

      // Ctrl+C
      if (data === "\x03") {
        if (runningRef.current && shellRef.current) {
          shellRef.current.kill();
          runningRef.current = false;
          shellRef.current = null;
          term.writeln("^C");
          printPrompt(term);
        } else {
          term.writeln("^C");
          inputBufRef.current = "";
          printPrompt(term);
        }
        return;
      }

      // Ctrl+L — clear
      if (data === "\x0c") {
        term.clear();
        printPrompt(term);
        return;
      }

      // Arrow Up
      if (data === "\x1b[A") {
        if (historyRef.current.length === 0) return;
        if (historyIdxRef.current === -1) {
          historyIdxRef.current = historyRef.current.length - 1;
        } else if (historyIdxRef.current > 0) {
          historyIdxRef.current--;
        }
        const item = historyRef.current[historyIdxRef.current];
        term.write("\r\x1b[K\x1b[32m❯\x1b[0m " + item);
        inputBufRef.current = item;
        return;
      }

      // Arrow Down
      if (data === "\x1b[B") {
        if (historyIdxRef.current === -1) return;
        historyIdxRef.current++;
        if (historyIdxRef.current >= historyRef.current.length) {
          historyIdxRef.current = -1;
          term.write("\r\x1b[K\x1b[32m❯\x1b[0m ");
          inputBufRef.current = "";
        } else {
          const item = historyRef.current[historyIdxRef.current];
          term.write("\r\x1b[K\x1b[32m❯\x1b[0m " + item);
          inputBufRef.current = item;
        }
        return;
      }

      // Ignore other escape sequences
      if (data.startsWith("\x1b")) return;

      // Regular character
      inputBufRef.current += data;
      term.write(data);
    },
    [printPrompt]
  );

  const executeCommand = useCallback(
    async (term: Terminal, nodebox: Nodebox, cmd: string) => {
      const parts = cmd.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
      const binary = parts[0]?.replace(/"/g, "");
      const args = parts.slice(1).map((a) => a.replace(/"/g, ""));

      if (!binary) {
        printPrompt(term);
        return;
      }

      // ── Handle built-in commands locally via Nodebox FS ──────────

      // node -v / node --version
      if (binary === "node" && (args[0] === "-v" || args[0] === "--version")) {
        term.writeln("v18.18.0 (Nodebox runtime)");
        printPrompt(term);
        return;
      }

      // npm / npx — not supported by Nodebox runtime
      if (binary === "npm" || binary === "npx") {
        term.writeln(`\x1b[33mnpm/npx is not available in Nodebox runtime.\x1b[0m`);
        term.writeln(`\x1b[2mNodebox auto-installs dependencies from package.json.\x1b[0m`);
        term.writeln(`\x1b[2mTo run scripts, call the tool directly: node file.js, vite build, etc.\x1b[0m`);
        printPrompt(term);
        return;
      }

      // pwd
      if (binary === "pwd") {
        term.writeln("/");
        printPrompt(term);
        return;
      }

      // ls — use Nodebox FS readdir
      if (binary === "ls") {
        try {
          const dir = args[0] || "/";
          const entries = await nodebox.fs.readdir(dir);
          term.writeln(entries.join("  "));
        } catch (err: any) {
          term.writeln(`\x1b[31mls: ${err?.message || err}\x1b[0m`);
        }
        printPrompt(term);
        return;
      }

      // cat — use Nodebox FS readFile
      if (binary === "cat" && args[0]) {
        try {
          const path = args[0].startsWith("/") ? args[0] : `/${args[0]}`;
          const content = await nodebox.fs.readFile(path, "utf8");
          term.writeln(String(content).replace(/(?<!\r)\n/g, "\r\n"));
        } catch (err: any) {
          term.writeln(`\x1b[31mcat: ${err?.message || err}\x1b[0m`);
        }
        printPrompt(term);
        return;
      }

      // mkdir
      if (binary === "mkdir" && args[0]) {
        try {
          const path = args[0].startsWith("/") ? args[0] : `/${args[0]}`;
          await nodebox.fs.mkdir(path, { recursive: true });
          term.writeln(`\x1b[32mcreated: ${path}\x1b[0m`);
        } catch (err: any) {
          term.writeln(`\x1b[31mmkdir: ${err?.message || err}\x1b[0m`);
        }
        printPrompt(term);
        return;
      }

      // rm
      if (binary === "rm" && args.length > 0) {
        try {
          const recursive = args.includes("-r") || args.includes("-rf") || args.includes("-fr");
          const target = args.filter((a) => !a.startsWith("-"))[0];
          if (!target) throw new Error("missing operand");
          const path = target.startsWith("/") ? target : `/${target}`;
          await nodebox.fs.rm(path, { recursive, force: true });
          term.writeln(`\x1b[32mremoved: ${path}\x1b[0m`);
        } catch (err: any) {
          term.writeln(`\x1b[31mrm: ${err?.message || err}\x1b[0m`);
        }
        printPrompt(term);
        return;
      }

      // clear
      if (binary === "clear") {
        term.clear();
        printPrompt(term);
        return;
      }

      // help
      if (binary === "help") {
        term.writeln("\x1b[1;36mPiPilot Node.js Terminal\x1b[0m");
        term.writeln("");
        term.writeln("\x1b[33mNode.js execution (via Nodebox):\x1b[0m");
        term.writeln("  node <file.js>       Run a JavaScript file");
        term.writeln("  \x1b[2mnpm/npx not available — Nodebox auto-installs deps from package.json\x1b[0m");
        term.writeln("");
        term.writeln("\x1b[33mFile system commands (built-in):\x1b[0m");
        term.writeln("  ls [path]            List directory");
        term.writeln("  cat <file>           Print file contents");
        term.writeln("  mkdir <dir>          Create directory");
        term.writeln("  rm [-r] <path>       Remove file/directory");
        term.writeln("  pwd                  Print working directory");
        term.writeln("  clear                Clear terminal");
        term.writeln("  help                 Show this help");
        term.writeln("");
        term.writeln("\x1b[2mNote: node -v and npm -v show Nodebox versions.\x1b[0m");
        term.writeln("\x1b[2mFor full file operations, use the Virtual Shell tab.\x1b[0m");
        printPrompt(term);
        return;
      }

      // ── Run via Nodebox shell (node, npm, npx, etc.) ─────────

      try {
        const shell = nodebox.shell.create();
        shellRef.current = shell;
        runningRef.current = true;

        // Listen to stdout
        shell.stdout.on("data", (data: string) => {
          const output = typeof data === "string" ? data : String(data);
          term.write(output.replace(/(?<!\r)\n/g, "\r\n"));
        });

        // Listen to stderr
        shell.stderr.on("data", (data: string) => {
          const output = typeof data === "string" ? data : String(data);
          term.write(output.replace(/(?<!\r)\n/g, "\r\n"));
        });

        // Run the command
        await shell.runCommand(binary, args);

        // Wait for exit
        await new Promise<void>((resolve) => {
          shell.on("exit", (exitCode: number, error?: { message: string }) => {
            if (error) {
              term.writeln(`\x1b[31m${error.message}\x1b[0m`);
            }
            if (exitCode !== 0 && exitCode !== undefined) {
              term.writeln(
                `\x1b[2mProcess exited with code ${exitCode}\x1b[0m`
              );
            }
            resolve();
          });
        });
      } catch (err: any) {
        const msg = err?.message || String(err);
        term.writeln(`\x1b[31m${msg}\x1b[0m`);
      }

      runningRef.current = false;
      shellRef.current = null;
      printPrompt(term);
    },
    [printPrompt]
  );

  // Sync files on demand
  const syncFiles = useCallback(async () => {
    const nodebox = nodeboxRef.current;
    if (!nodebox) return;
    const count = await syncFilesToNodebox(nodebox, activeProjectId);
    xtermRef.current?.writeln(
      `\r\n\x1b[32m✓ ${count} files re-synced\x1b[0m\r\n`
    );
    printPrompt(xtermRef.current!);
  }, [activeProjectId, printPrompt]);

  return (
    <div style={{ height: "100%", position: "relative" }}>
      <div
        ref={termRef}
        style={{ height: "100%", width: "100%", background: "#1a1d23" }}
      />
      {status === "booting" && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 12,
            fontSize: 10,
            color: "hsl(38 92% 50%)",
            background: "hsl(220 13% 15% / 0.9)",
            padding: "2px 8px",
            borderRadius: 4,
          }}
        >
          Booting Nodebox...
        </div>
      )}
      {status === "syncing" && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 12,
            fontSize: 10,
            color: "hsl(207 90% 60%)",
            background: "hsl(220 13% 15% / 0.9)",
            padding: "2px 8px",
            borderRadius: 4,
          }}
        >
          Syncing files...
        </div>
      )}
      {status === "ready" && (
        <button
          onClick={syncFiles}
          style={{
            position: "absolute",
            top: 6,
            right: 12,
            fontSize: 10,
            color: "hsl(220 14% 55%)",
            background: "hsl(220 13% 18%)",
            border: "1px solid hsl(220 13% 28%)",
            padding: "2px 8px",
            borderRadius: 4,
            cursor: "pointer",
          }}
          title="Re-sync project files to Nodebox"
        >
          Sync Files
        </button>
      )}
    </div>
  );
}
