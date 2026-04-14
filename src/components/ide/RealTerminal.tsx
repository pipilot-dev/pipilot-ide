import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { db } from "@/lib/db";
import { terminalBridge } from "@/lib/terminal-bridge";

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
      fontSize: parseInt(getSetting("terminalFontSize", "13")) || 13,
      scrollback: parseInt(getSetting("terminalScrollback", "5000")) || 5000,
      fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", "Consolas", monospace',
      fontWeight: "500",
      fontWeightBold: "500",
      letterSpacing: 1,
      drawBoldTextInBrightColors: false,
      allowProposedApi: true,
      allowTransparency: true,
      theme: {
        background: "#16161a",
        foreground: "#e0e0e6",
        cursor: "#a1e67b",
        cursorAccent: "#16161a",
        selectionBackground: "rgba(161, 230, 123, 0.18)",
        black: "#16161a",
        red: "#e06c75",
        green: "#98c379",
        yellow: "#e5c07b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#56b6c2",
        white: "#abb2bf",
        brightBlack: "#5c6370",
        brightRed: "#e06c75",
        brightGreen: "#98c379",
        brightYellow: "#e5c07b",
        brightBlue: "#61afef",
        brightMagenta: "#c678dd",
        brightCyan: "#56b6c2",
        brightWhite: "#f0f0f4",
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(el);
    termRef.current = term;
    fitRef.current = fitAddon;

    // Bridge handles Tauri IPC (desktop) vs HTTP+SSE (web) automatically
    const writeToPty = (data: string) => terminalBridge.write(sid, data);
    const resizePty = (cols: number, rows: number) => terminalBridge.resize(sid, cols, rows);

    // Fit after next render frame
    let fitTimer: ReturnType<typeof setTimeout>;
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch {}
    });

    // Track cleanup functions from bridge listeners
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    // Create PTY session via bridge
    terminalBridge.create({
      projectId: pid,
      sessionId: sid,
      profile: profileRef.current,
    }).then(({ id: termId }) => {
      // Listen for PTY output → write to xterm
      let firstOutputReceived = false;
      let initialCmdSent = false;
      const sendInitialCmd = () => {
        if (initialCmdSent) return;
        const cmd = initialCommandRef.current;
        if (!cmd) return;
        initialCmdSent = true;
        setTimeout(() => writeToPty(cmd + "\r"), 250);
      };

      unlistenData = terminalBridge.onData(termId, (data) => {
        term.write(data);
        if (!firstOutputReceived) {
          firstOutputReceived = true;
          sendInitialCmd();
        }
      });

      unlistenExit = terminalBridge.onExit(termId, () => {
        term.writeln("\r\n\x1b[33m[Process exited]\x1b[0m");
        onExitRef.current?.();
      });

      // Send initial resize after connection
      setTimeout(() => {
        try {
          fitAddon.fit();
          resizePty(term.cols, term.rows);
        } catch {}
      }, 150);

      // Fallback: send initial command after 2s if no output yet
      setTimeout(sendInitialCmd, 2000);
    }).catch(() => {
      term.writeln("\r\n\x1b[31mFailed to connect to terminal\x1b[0m");
    });

    // Forward keyboard input
    const dataDisposable = term.onData(writeToPty);

    // Listen for AI agent's terminal commands
    const onTerminalSend = (e: Event) => {
      const cmd = (e as CustomEvent).detail?.command;
      if (cmd) writeToPty(cmd + "\r");
    };
    window.addEventListener("pipilot:terminal-send", onTerminalSend);

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
      window.removeEventListener("pipilot:terminal-send", onTerminalSend);
      window.removeEventListener("pipilot:setting-changed", onSettingChanged);
      // Cleanup bridge listeners + kill PTY
      unlistenData?.();
      unlistenExit?.();
      terminalBridge.kill(sid);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      initRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps — init once, use refs for mutable values

  return (
    <>
      <style>{`
        .pipilot-terminal { width: 100%; height: 100%; overflow: hidden; }
        .pipilot-terminal .xterm { height: 100%; }
        .pipilot-terminal .xterm-viewport {
          background: transparent !important;
          overflow-y: hidden !important;
          font-variant-ligatures: none;
          -webkit-font-smoothing: antialiased;
        }
        .pipilot-terminal .xterm-screen { padding: 0 8px; }
      `}</style>
      <div ref={containerRef} className="pipilot-terminal" />
    </>
  );
}
