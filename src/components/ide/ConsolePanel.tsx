import { useState, useRef, useEffect, useCallback } from "react";
import { Trash2, ChevronDown, ChevronUp, AlertTriangle, Info, AlertCircle, Terminal, Copy, Check } from "lucide-react";

export interface ConsoleEntry {
  id: number;
  timestamp: number;
  level: "log" | "info" | "warn" | "error" | "system";
  source: "server" | "runtime" | "system";
  text: string;
}

interface ConsolePanelProps {
  entries: ConsoleEntry[];
  onClear: () => void;
  defaultOpen?: boolean;
}

const LEVEL_COLORS: Record<ConsoleEntry["level"], string> = {
  log: "hsl(220 14% 80%)",
  info: "hsl(207 90% 65%)",
  warn: "hsl(38 92% 60%)",
  error: "hsl(0 84% 65%)",
  system: "hsl(220 14% 55%)",
};

const LEVEL_BG: Record<ConsoleEntry["level"], string> = {
  log: "transparent",
  info: "transparent",
  warn: "hsl(38 92% 50% / 0.06)",
  error: "hsl(0 84% 50% / 0.08)",
  system: "hsl(207 90% 50% / 0.05)",
};

const SOURCE_BADGE: Record<ConsoleEntry["source"], { label: string; color: string }> = {
  server: { label: "server", color: "hsl(142 71% 45%)" },
  runtime: { label: "app", color: "hsl(207 90% 60%)" },
  system: { label: "sys", color: "hsl(220 14% 50%)" },
};

function LevelIcon({ level }: { level: ConsoleEntry["level"] }) {
  const size = 11;
  switch (level) {
    case "warn": return <AlertTriangle size={size} style={{ color: LEVEL_COLORS.warn, flexShrink: 0 }} />;
    case "error": return <AlertCircle size={size} style={{ color: LEVEL_COLORS.error, flexShrink: 0 }} />;
    case "info": return <Info size={size} style={{ color: LEVEL_COLORS.info, flexShrink: 0 }} />;
    case "system": return <Terminal size={size} style={{ color: LEVEL_COLORS.system, flexShrink: 0 }} />;
    default: return null;
  }
}

function CopyLogsButton({ entries }: { entries: ConsoleEntry[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = entries
      .map(e => `[${e.source}] [${e.level}] ${e.text.trim()}`)
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [entries]);

  return (
    <button
      onClick={handleCopy}
      style={{ background: "none", border: "none", color: copied ? "hsl(142 71% 55%)" : "hsl(220 14% 40%)", cursor: "pointer", padding: 2 }}
      title="Copy filtered logs"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
    </button>
  );
}

export function ConsolePanel({ entries, onClear, defaultOpen = false }: ConsolePanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [filter, setFilter] = useState<"all" | "error" | "warn" | "info">("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const errorCount = entries.filter(e => e.level === "error").length;
  const warnCount = entries.filter(e => e.level === "warn").length;

  const filtered = filter === "all"
    ? entries
    : entries.filter(e => e.level === filter || e.level === "system");

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 30;
  }, []);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          width: "100%", padding: "3px 8px",
          background: "hsl(220 13% 12%)",
          borderTop: "1px solid hsl(220 13% 22%)",
          border: "none", borderTop: "1px solid hsl(220 13% 22%)",
          cursor: "pointer", color: "hsl(220 14% 55%)", fontSize: 10,
        }}
      >
        <ChevronUp size={10} />
        <span style={{ fontWeight: 600 }}>Console</span>
        {errorCount > 0 && (
          <span style={{ color: LEVEL_COLORS.error, fontWeight: 700 }}>{errorCount} error{errorCount > 1 ? "s" : ""}</span>
        )}
        {warnCount > 0 && (
          <span style={{ color: LEVEL_COLORS.warn }}>{warnCount} warn</span>
        )}
        {entries.length > 0 && errorCount === 0 && warnCount === 0 && (
          <span style={{ color: "hsl(220 14% 40%)" }}>{entries.length} logs</span>
        )}
      </button>
    );
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: 180, minHeight: 100,
      borderTop: "1px solid hsl(220 13% 22%)",
      background: "hsl(220 13% 10%)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "2px 8px", height: 24, minHeight: 24,
        background: "hsl(220 13% 13%)",
        borderBottom: "1px solid hsl(220 13% 20%)",
      }}>
        <button
          onClick={() => setOpen(false)}
          style={{ background: "none", border: "none", color: "hsl(220 14% 55%)", cursor: "pointer", padding: 2 }}
        >
          <ChevronDown size={10} />
        </button>
        <span style={{ fontSize: 10, fontWeight: 600, color: "hsl(220 14% 70%)" }}>Console</span>

        {/* Filter pills */}
        <div style={{ display: "flex", gap: 2, marginLeft: 8 }}>
          {(["all", "error", "warn", "info"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "1px 6px", fontSize: 9, borderRadius: 3,
                border: "none", cursor: "pointer",
                background: filter === f ? "hsl(220 13% 25%)" : "transparent",
                color: f === "error" ? LEVEL_COLORS.error
                  : f === "warn" ? LEVEL_COLORS.warn
                  : f === "info" ? LEVEL_COLORS.info
                  : "hsl(220 14% 55%)",
                fontWeight: filter === f ? 600 : 400,
              }}
            >
              {f === "all" ? `All (${entries.length})` : f === "error" ? `Errors (${errorCount})` : f === "warn" ? `Warnings (${warnCount})` : "Info"}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />
        <CopyLogsButton entries={filtered} />
        <button
          onClick={onClear}
          style={{ background: "none", border: "none", color: "hsl(220 14% 40%)", cursor: "pointer", padding: 2 }}
          title="Clear console"
        >
          <Trash2 size={10} />
        </button>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1, overflowY: "auto", overflowX: "hidden",
          fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
          fontSize: 10, lineHeight: "16px",
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ padding: "12px 8px", color: "hsl(220 14% 35%)", textAlign: "center", fontSize: 10 }}>
            No console output yet
          </div>
        ) : filtered.map(entry => (
          <div
            key={entry.id}
            style={{
              display: "flex", alignItems: "flex-start", gap: 6,
              padding: "1px 8px",
              background: LEVEL_BG[entry.level],
              borderBottom: "1px solid hsl(220 13% 14%)",
            }}
          >
            <LevelIcon level={entry.level} />
            <span style={{
              fontSize: 8, padding: "1px 3px", borderRadius: 2,
              color: SOURCE_BADGE[entry.source].color,
              background: `${SOURCE_BADGE[entry.source].color}15`,
              flexShrink: 0, marginTop: 1,
            }}>
              {SOURCE_BADGE[entry.source].label}
            </span>
            <span style={{
              color: LEVEL_COLORS[entry.level],
              whiteSpace: "pre-wrap", wordBreak: "break-all",
              flex: 1,
            }}>
              {entry.text.trim()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
