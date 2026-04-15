import { useMemo } from "react";
import { COLORS as C, FONTS, SECTION_LABEL_STYLE } from "@/lib/design-tokens";
import type { ChatMessage, ToolCallInfo } from "@/hooks/useChat";
import {
  FileText,
  Pencil,
  Eye,
  Terminal,
  Search,
  Trash2,
  Globe,
  Brain,
  FolderTree,
  Play,
  HelpCircle,
} from "lucide-react";

// ── Activity types ──────────────────────────────────────────────────────────

type ActivityKind =
  | "create"
  | "edit"
  | "read"
  | "bash"
  | "search"
  | "delete"
  | "web"
  | "running"
  | "unknown";

interface Activity {
  id: string;
  kind: ActivityKind;
  label: string;
  detail?: string;
  timestamp: Date;
  filePath?: string; // clickable file path
  status: ToolCallInfo["status"];
}

// ── Colour map ──────────────────────────────────────────────────────────────

const DOT_COLORS: Record<ActivityKind, string> = {
  create: C.ok,
  edit: C.warn,
  read: C.info,
  bash: "#b48ead",    // soft purple
  search: C.textMid,
  delete: C.error,
  web: C.info,
  running: C.accent,
  unknown: C.textDim,
};

// ── Icon map ────────────────────────────────────────────────────────────────

const ICON_MAP: Record<ActivityKind, React.FC<{ size?: number; color?: string }>> = {
  create: FileText,
  edit: Pencil,
  read: Eye,
  bash: Terminal,
  search: Search,
  delete: Trash2,
  web: Globe,
  running: Brain,
  unknown: HelpCircle,
};

// ── Parse helpers ───────────────────────────────────────────────────────────

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

function tryParseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function classifyTool(tc: ToolCallInfo): Activity {
  const args = tryParseArgs(tc.arguments);
  const path = (args.path ?? args.file_path ?? args.filePath ?? "") as string;
  const base: Omit<Activity, "kind" | "label" | "detail"> = {
    id: tc.id,
    timestamp: new Date(), // will be overridden
    filePath: path || undefined,
    status: tc.status,
  };

  const name = tc.name.toLowerCase();

  // Create
  if (name === "create_file" || name === "write" || name === "batch_create_files") {
    const fileCount =
      name === "batch_create_files"
        ? Array.isArray(args.files)
          ? (args.files as unknown[]).length
          : "?"
        : undefined;
    return {
      ...base,
      kind: "create",
      label: fileCount ? `Created ${fileCount} files` : `Created ${basename(path)}`,
      detail: path || undefined,
    };
  }

  // Edit
  if (name === "edit_file" || name === "edit" || name === "multiedit") {
    return { ...base, kind: "edit", label: `Edited ${basename(path)}`, detail: path };
  }

  // Read
  if (name === "read_file" || name === "read") {
    return { ...base, kind: "read", label: `Read ${basename(path)}`, detail: path };
  }

  // Delete
  if (name === "delete_file" || name === "delete") {
    return { ...base, kind: "delete", label: `Deleted ${basename(path)}`, detail: path };
  }

  // Bash / terminal
  if (name === "bash" || name === "run_script") {
    const cmd = (args.command ?? args.code ?? "") as string;
    const short = cmd.length > 40 ? cmd.slice(0, 37) + "..." : cmd;
    const success = tc.status === "done" && !tc.result?.startsWith("Error");
    return {
      ...base,
      kind: "bash",
      label: `Ran: ${short || "command"}`,
      detail: success ? "success" : tc.status === "error" ? "failed" : undefined,
      filePath: undefined,
    };
  }

  // Search
  if (
    name === "grep" ||
    name === "glob" ||
    name === "search_files" ||
    name === "list_files" ||
    name === "get_project_tree"
  ) {
    if (name === "list_files") {
      return { ...base, kind: "search", label: `Listed ${path || "root"}`, detail: path };
    }
    if (name === "get_project_tree") {
      return {
        ...base,
        kind: "search",
        label: "Project tree",
        detail: undefined,
        filePath: undefined,
      };
    }
    const query = (args.query ?? args.pattern ?? "") as string;
    const short = query.length > 30 ? query.slice(0, 27) + "..." : query;
    return { ...base, kind: "search", label: `Searched: "${short}"`, filePath: undefined };
  }

  // Web
  if (name === "websearch" || name === "webfetch") {
    const q = (args.query ?? args.url ?? "") as string;
    const short = q.length > 35 ? q.slice(0, 32) + "..." : q;
    return { ...base, kind: "web", label: `Web: ${short}`, filePath: undefined };
  }

  // Unknown
  return { ...base, kind: "unknown", label: tc.name, filePath: undefined };
}

// ── Extract activities from messages ────────────────────────────────────────

function extractActivities(messages: ChatMessage[]): Activity[] {
  const activities: Activity[] = [];
  for (const msg of messages) {
    if (!msg.toolCalls?.length) continue;
    for (const tc of msg.toolCalls) {
      const a = classifyTool(tc);
      a.timestamp = msg.timestamp;
      activities.push(a);
    }
  }
  return activities;
}

// ── Relative timestamp ──────────────────────────────────────────────────────

function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 10_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString();
}

// ── Stats ───────────────────────────────────────────────────────────────────

interface Stats {
  created: number;
  edited: number;
  commands: number;
  reads: number;
  searches: number;
  deleted: number;
  web: number;
  total: number;
}

function computeStats(activities: Activity[]): Stats {
  const s: Stats = { created: 0, edited: 0, commands: 0, reads: 0, searches: 0, deleted: 0, web: 0, total: activities.length };
  for (const a of activities) {
    if (a.kind === "create") s.created++;
    else if (a.kind === "edit") s.edited++;
    else if (a.kind === "bash") s.commands++;
    else if (a.kind === "read") s.reads++;
    else if (a.kind === "search") s.searches++;
    else if (a.kind === "delete") s.deleted++;
    else if (a.kind === "web") s.web++;
  }
  return s;
}

// ── Keyframe styles (injected once) ─────────────────────────────────────────

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes ab-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(1.4); }
    }
    .ab-row:hover { background: ${C.surfaceAlt}; }
  `;
  document.head.appendChild(style);
}

// ── Component ───────────────────────────────────────────────────────────────

interface ActivityBoardProps {
  messages: ChatMessage[];
}

export function ActivityBoard({ messages }: ActivityBoardProps) {
  injectStyles();

  const activities = useMemo(() => extractActivities(messages), [messages]);
  const stats = useMemo(() => computeStats(activities), [activities]);

  const openFile = (path: string) => {
    window.dispatchEvent(
      new CustomEvent("pipilot:open-file", { detail: { filePath: path } }),
    );
  };

  // ── Empty state ─────────────────────────────────────────────────────────
  if (activities.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
          fontFamily: FONTS.sans,
          color: C.textDim,
          textAlign: "center",
        }}
      >
        <FolderTree size={32} color={C.textFaint} />
        <span style={{ fontSize: 13, lineHeight: 1.5 }}>
          No activity yet — start chatting with the agent
        </span>
      </div>
    );
  }

  // ── Timeline ────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        fontFamily: FONTS.sans,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          ...SECTION_LABEL_STYLE,
          padding: "10px 14px 8px",
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        ACTIVITY
      </div>

      {/* Scrollable timeline */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 0",
        }}
      >
        {activities.map((a, i) => {
          const isRunning = a.status === "running" || a.status === "pending";
          const effectiveKind = isRunning ? "running" : a.kind;
          const dotColor = DOT_COLORS[effectiveKind];
          const Icon = ICON_MAP[isRunning ? "running" : a.kind];
          const isLast = i === activities.length - 1;
          const clickable = !!a.filePath;

          return (
            <div
              key={a.id}
              className="ab-row"
              onClick={clickable ? () => openFile(a.filePath!) : undefined}
              style={{
                display: "flex",
                gap: 0,
                padding: "2px 14px 2px 10px",
                cursor: clickable ? "pointer" : "default",
                borderRadius: 4,
                transition: "background 0.15s",
              }}
            >
              {/* Timeline column: dot + line */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  width: 20,
                  flexShrink: 0,
                  paddingTop: 6,
                }}
              >
                {/* Dot */}
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: dotColor,
                    flexShrink: 0,
                    boxShadow: `0 0 6px ${dotColor}60`,
                    animation: isRunning ? "ab-pulse 1.4s ease-in-out infinite" : "none",
                  }}
                />
                {/* Line */}
                {!isLast && (
                  <div
                    style={{
                      width: 1,
                      flex: 1,
                      minHeight: 16,
                      background: C.border,
                      marginTop: 2,
                    }}
                  />
                )}
              </div>

              {/* Content column */}
              <div style={{ flex: 1, minWidth: 0, padding: "2px 0 10px 6px" }}>
                {/* Timestamp */}
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    color: C.textDim,
                    fontFamily: FONTS.mono,
                    marginBottom: 2,
                    letterSpacing: "0.02em",
                  }}
                >
                  {relativeTime(a.timestamp)}
                </div>

                {/* Label */}
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: C.text,
                    lineHeight: 1.4,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {a.label}
                </div>

                {/* Detail row: icon + detail text */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 2,
                  }}
                >
                  <Icon size={12} color={C.textDim} />
                  {a.detail && (
                    <span
                      style={{
                        fontSize: 11,
                        color: C.textDim,
                        fontFamily: FONTS.mono,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {a.detail}
                    </span>
                  )}
                  {a.kind === "bash" && a.status === "done" && (
                    <span style={{ fontSize: 11, color: C.ok }}>
                      {a.detail === "failed" ? "failed" : "success"}
                    </span>
                  )}
                  {a.kind === "bash" && a.status === "error" && (
                    <span style={{ fontSize: 11, color: C.error }}>failed</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Stats footer */}
      <div
        style={{
          flexShrink: 0,
          borderTop: `1px solid ${C.border}`,
          padding: "10px 14px",
        }}
      >
        <div
          style={{
            ...SECTION_LABEL_STYLE,
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Play size={10} color={C.textDim} />
          Stats
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "4px 12px",
            fontSize: 11,
            fontFamily: FONTS.mono,
            color: C.textMid,
          }}
        >
          {stats.created > 0 && (
            <StatRow color={DOT_COLORS.create} label="Created" value={stats.created} />
          )}
          {stats.edited > 0 && (
            <StatRow color={DOT_COLORS.edit} label="Edited" value={stats.edited} />
          )}
          {stats.commands > 0 && (
            <StatRow color={DOT_COLORS.bash} label="Commands" value={stats.commands} />
          )}
          {stats.reads > 0 && (
            <StatRow color={DOT_COLORS.read} label="Reads" value={stats.reads} />
          )}
          {stats.searches > 0 && (
            <StatRow color={DOT_COLORS.search} label="Searches" value={stats.searches} />
          )}
          {stats.deleted > 0 && (
            <StatRow color={DOT_COLORS.delete} label="Deleted" value={stats.deleted} />
          )}
          {stats.web > 0 && (
            <StatRow color={DOT_COLORS.web} label="Web" value={stats.web} />
          )}
          <div
            style={{
              gridColumn: "1 / -1",
              borderTop: `1px solid ${C.border}`,
              paddingTop: 4,
              marginTop: 2,
              display: "flex",
              justifyContent: "space-between",
              fontWeight: 600,
              color: C.text,
            }}
          >
            <span>Total actions</span>
            <span>{stats.total}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stat row helper ─────────────────────────────────────────────────────────

function StatRow({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontWeight: 600, color: C.text }}>{value}</span>
    </div>
  );
}

export default ActivityBoard;
