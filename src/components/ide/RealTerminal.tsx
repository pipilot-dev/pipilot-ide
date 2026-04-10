import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface RealTerminalProps {
  sessionId: string;
  projectId: string;
  initialCommand?: string;
  onExit?: () => void;
}

export function RealTerminal({ sessionId, projectId, initialCommand, onExit }: RealTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const initRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  const projectIdRef = useRef(projectId);
  const initialCommandRef = useRef(initialCommand);
  const onExitRef = useRef(onExit);

  // Keep refs in sync without triggering re-renders
  sessionIdRef.current = sessionId;
  projectIdRef.current = projectId;
  initialCommandRef.current = initialCommand;
  onExitRef.current = onExit;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || initRef.current) return;
    initRef.current = true;

    const sid = sessionIdRef.current;
    const pid = projectIdRef.current;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      scrollback: 10000,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
        black: "#0d1117",
        red: "#ff7b72",
        green: "#7ee787",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#c9d1d9",
        brightBlack: "#484f58",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(el);
    termRef.current = term;
    fitRef.current = fitAddon;

    // Helper functions using closure over sid
    const writeToPty = (data: string) => {
      fetch("/api/terminal/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, data }),
      }).catch(() => {});
    };

    const resizePty = (cols: number, rows: number) => {
      fetch("/api/terminal/resize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, cols, rows }),
      }).catch(() => {});
    };

    // Fit after layout settles
    const fitTimer = setTimeout(() => {
      try { fitAddon.fit(); } catch {}
    }, 100);

    // Create PTY session
    fetch("/api/terminal/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: pid, sessionId: sid }),
    }).then(async (res) => {
      if (!res.ok) {
        term.writeln("\r\n\x1b[31mFailed to create terminal session\x1b[0m");
        return;
      }

      // Connect SSE for output
      const es = new EventSource(`/api/terminal/stream?sessionId=${encodeURIComponent(sid)}`);
      sseRef.current = es;

      // Track when shell is ready (first output received) to send initial command
      let firstOutputReceived = false;
      let initialCmdSent = false;
      const sendInitialCmd = () => {
        if (initialCmdSent) return;
        const cmd = initialCommandRef.current;
        if (!cmd) return;
        initialCmdSent = true;
        // Small delay to let the prompt render
        setTimeout(() => writeToPty(cmd + "\r"), 250);
      };

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.output) {
            term.write(data.output);
            if (!firstOutputReceived) {
              firstOutputReceived = true;
              sendInitialCmd();
            }
          }
          if (data.exit) {
            term.writeln("\r\n\x1b[33m[Process exited]\x1b[0m");
            es.close();
            onExitRef.current?.();
          }
        } catch {}
      };

      // Send initial resize after SSE connects
      setTimeout(() => {
        try {
          fitAddon.fit();
          resizePty(term.cols, term.rows);
        } catch {}
      }, 150);

      // Fallback: if no output arrives within 2s (e.g. very fast empty prompt),
      // still try to send the initial command
      setTimeout(sendInitialCmd, 2000);
    }).catch(() => {
      term.writeln("\r\n\x1b[31mFailed to connect to terminal server\x1b[0m");
    });

    // Forward keyboard input
    const dataDisposable = term.onData(writeToPty);

    // Debounced resize handler
    let resizeTimer: ReturnType<typeof setTimeout>;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          fitAddon.fit();
          if (term.cols > 0 && term.rows > 0) {
            resizePty(term.cols, term.rows);
          }
        } catch {}
      }, 100);
    });
    resizeObserver.observe(el);

    return () => {
      clearTimeout(fitTimer);
      clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      sseRef.current?.close();
      sseRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      initRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps — init once, use refs for mutable values

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        background: "#0d1117",
        overflow: "hidden",
      }}
    />
  );
}
