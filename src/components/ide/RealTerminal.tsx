import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { db } from "@/lib/db";

// Read terminal settings — prefer localStorage (always up-to-date from
// SettingsTabView save()), fall back to IndexedDB cache.
function getSetting(key: string, fallback: string): string {
  try {
    const ls = localStorage.getItem(`pipilot:${key}`);
    if (ls !== null) return ls;
  } catch {}
  return fallback;
}

interface RealTerminalProps {
  sessionId: string;
  projectId: string;
  initialCommand?: string;
  /** Shell profile id (e.g. "bash", "pwsh", "cmd"). Omit for host default. */
  profile?: string;
  onExit?: () => void;
}

export function RealTerminal({ sessionId, projectId, initialCommand, profile, onExit }: RealTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const initRef = useRef(false);
  const sessionIdRef = useRef(sessionId);
  const projectIdRef = useRef(projectId);
  const initialCommandRef = useRef(initialCommand);
  const profileRef = useRef(profile);
  const onExitRef = useRef(onExit);

  // Keep refs in sync without triggering re-renders
  sessionIdRef.current = sessionId;
  projectIdRef.current = projectId;
  initialCommandRef.current = initialCommand;
  profileRef.current = profile;
  onExitRef.current = onExit;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || initRef.current) return;
    initRef.current = true;

    const sid = sessionIdRef.current;
    const pid = projectIdRef.current;

    const term = new Terminal({
      cursorBlink: getSetting("terminalCursorBlink", "true") !== "false",
      fontSize: parseInt(getSetting("terminalFontSize", "12")) || 12,
      scrollback: parseInt(getSetting("terminalScrollback", "10000")) || 10000,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
      theme: {
        background: "#16161a",
        foreground: "#a0a0a8",
        cursor: "#8a8a94",
        selectionBackground: "#2a3a5040",
        black: "#16161a",
        red: "#c06a64",
        green: "#7ea868",
        yellow: "#b09060",
        blue: "#6a9ec0",
        magenta: "#9880b8",
        cyan: "#5aab9e",
        white: "#a0a0a8",
        brightBlack: "#5f5f6a",
        brightRed: "#c06a64",
        brightGreen: "#7ea868",
        brightYellow: "#b09060",
        brightBlue: "#6a9ec0",
        brightMagenta: "#9880b8",
        brightCyan: "#5aab9e",
        brightWhite: "#b0b0b8",
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
      body: JSON.stringify({
        projectId: pid,
        sessionId: sid,
        profile: profileRef.current,
      }),
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

    // Listen for settings changes and apply to the running terminal
    const onSettingChanged = (e: Event) => {
      const { key, value } = (e as CustomEvent).detail || {};
      if (!key) return;
      switch (key) {
        case "terminalFontSize":
          term.options.fontSize = parseInt(value) || 12;
          try { fitAddon.fit(); } catch {}
          break;
        case "terminalCursorBlink":
          term.options.cursorBlink = value !== "false";
          break;
        case "terminalScrollback":
          term.options.scrollback = parseInt(value) || 10000;
          break;
      }
    };
    window.addEventListener("pipilot:setting-changed", onSettingChanged);

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
      window.removeEventListener("pipilot:setting-changed", onSettingChanged);
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
