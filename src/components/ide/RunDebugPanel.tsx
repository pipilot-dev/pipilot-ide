import { useState, useEffect, useCallback } from "react";
import {
  Play, Bug, RefreshCw, Package, Terminal, Loader2, Hammer,
  Zap, ListChecks, FileCode, Boxes, Globe, ChevronRight,
} from "lucide-react";
import { useActiveProject } from "@/contexts/ProjectContext";

interface RunDebugPanelProps {
  onRunPreview?: () => void;
  onOpenTerminal?: () => void;
}

interface ProjectScripts {
  scripts: Record<string, string>;
  hasPackageJson: boolean;
  name?: string;
  version?: string;
}

/**
 * Dispatches a global event for TerminalPanel to pick up and create a
 * new system-shell tab that runs the given command.
 */
function runInNewTerminal(command: string, label?: string) {
  window.dispatchEvent(new CustomEvent("pipilot:run-in-terminal", {
    detail: { command, label },
  }));
}

function getScriptIcon(name: string) {
  if (name === "dev" || name === "start" || name === "serve") return <Play size={11} />;
  if (name === "build") return <Hammer size={11} />;
  if (name === "test" || name.startsWith("test:")) return <ListChecks size={11} />;
  if (name === "lint") return <FileCode size={11} />;
  return <ChevronRight size={11} />;
}

function getScriptColor(name: string) {
  if (name === "dev" || name === "start" || name === "serve") return "hsl(142 71% 50%)";
  if (name === "build") return "hsl(38 92% 60%)";
  if (name === "test" || name.startsWith("test:")) return "hsl(207 90% 60%)";
  if (name === "lint") return "hsl(280 75% 65%)";
  return "hsl(220 14% 65%)";
}

export function RunDebugPanel({ onRunPreview, onOpenTerminal }: RunDebugPanelProps) {
  const { activeProjectId } = useActiveProject();
  const [scripts, setScripts] = useState<ProjectScripts | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/project/scripts?projectId=${encodeURIComponent(activeProjectId)}`);
      if (res.ok) {
        const data = await res.json();
        setScripts(data);
      } else {
        setScripts({ scripts: {}, hasPackageJson: false });
      }
    } catch {
      setScripts({ scripts: {}, hasPackageJson: false });
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runScript = useCallback((scriptName: string) => {
    onOpenTerminal?.();
    runInNewTerminal(`pnpm run ${scriptName}`, scriptName);
  }, [onOpenTerminal]);

  const runCommand = useCallback((cmd: string, label?: string) => {
    onOpenTerminal?.();
    runInNewTerminal(cmd, label);
  }, [onOpenTerminal]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", color: "hsl(220 14% 75%)" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "8px 10px",
        borderBottom: "1px solid hsl(220 13% 22%)",
      }}>
        <Bug size={12} style={{ color: "hsl(207 90% 60%)" }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 14% 75%)", textTransform: "uppercase", letterSpacing: 0.5 }}>
          Run and Debug
        </span>
        <div className="flex-1" />
        <button
          onClick={refresh}
          title="Refresh"
          style={{ background: "none", border: "none", color: "hsl(220 14% 55%)", cursor: "pointer", padding: 2 }}
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Quick actions */}
        <div style={{ padding: "8px 10px", borderBottom: "1px solid hsl(220 13% 22%)" }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: "hsl(220 14% 50%)",
            textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6,
          }}>
            Quick Actions
          </div>

          {onRunPreview && (
            <button
              onClick={onRunPreview}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "8px 10px", marginBottom: 4,
                fontSize: 11, fontWeight: 600,
                background: "linear-gradient(135deg, hsl(142 71% 45%), hsl(142 71% 38%))",
                color: "#fff", border: "none", borderRadius: 5, cursor: "pointer",
              }}
            >
              <Globe size={12} />
              Open Web Preview
            </button>
          )}
        </div>

        {/* package.json scripts */}
        {scripts?.hasPackageJson && Object.keys(scripts.scripts).length > 0 && (
          <div style={{ padding: "8px 10px", borderBottom: "1px solid hsl(220 13% 22%)" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: 10, fontWeight: 600, color: "hsl(220 14% 50%)",
              textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6,
            }}>
              <Package size={10} />
              <span>package.json</span>
              {scripts.name && (
                <span style={{ color: "hsl(220 14% 35%)", textTransform: "none", fontWeight: 400, marginLeft: 4 }}>
                  · {scripts.name}{scripts.version ? `@${scripts.version}` : ""}
                </span>
              )}
            </div>

            {Object.entries(scripts.scripts).map(([name, cmd]) => (
              <button
                key={name}
                onClick={() => runScript(name)}
                title={cmd}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", padding: "5px 8px", marginBottom: 2,
                  fontSize: 11, textAlign: "left",
                  background: "transparent", color: "hsl(220 14% 80%)",
                  border: "1px solid transparent", borderRadius: 4, cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "hsl(220 13% 18%)";
                  e.currentTarget.style.borderColor = "hsl(220 13% 25%)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "transparent";
                }}
              >
                <span style={{ color: getScriptColor(name), flexShrink: 0 }}>
                  {getScriptIcon(name)}
                </span>
                <span style={{ fontWeight: 600, color: getScriptColor(name) }}>{name}</span>
                <span style={{
                  flex: 1, color: "hsl(220 14% 45%)", fontSize: 10,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  fontFamily: "monospace",
                }}>
                  {cmd}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Common commands */}
        <div style={{ padding: "8px 10px", borderBottom: "1px solid hsl(220 13% 22%)" }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: "hsl(220 14% 50%)",
            textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6,
          }}>
            Common Tasks
          </div>

          {[
            { label: "Install dependencies", cmd: "pnpm install", icon: <Boxes size={11} />, color: "hsl(207 90% 60%)" },
            { label: "Update dependencies", cmd: "pnpm update", icon: <Boxes size={11} />, color: "hsl(38 92% 60%)" },
            { label: "List installed packages", cmd: "pnpm list", icon: <Package size={11} />, color: "hsl(220 14% 65%)" },
            { label: "Open shell here", cmd: "", icon: <Terminal size={11} />, color: "hsl(220 14% 70%)" },
          ].map((task) => (
            <button
              key={task.label}
              onClick={() => task.cmd ? runCommand(task.cmd, task.label) : (onOpenTerminal?.(), runInNewTerminal("", "shell"))}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "5px 8px", marginBottom: 2,
                fontSize: 11, textAlign: "left",
                background: "transparent", color: "hsl(220 14% 80%)",
                border: "1px solid transparent", borderRadius: 4, cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "hsl(220 13% 18%)";
                e.currentTarget.style.borderColor = "hsl(220 13% 25%)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "transparent";
              }}
            >
              <span style={{ color: task.color, flexShrink: 0 }}>{task.icon}</span>
              <span>{task.label}</span>
              {task.cmd && (
                <span style={{
                  flex: 1, color: "hsl(220 14% 40%)", fontSize: 10,
                  textAlign: "right", fontFamily: "monospace",
                }}>
                  {task.cmd}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Empty state */}
        {!loading && (!scripts?.hasPackageJson || Object.keys(scripts.scripts).length === 0) && (
          <div style={{ padding: 20, textAlign: "center", color: "hsl(220 14% 40%)", fontSize: 11 }}>
            <Zap size={24} style={{ display: "block", margin: "0 auto 8px", opacity: 0.5 }} />
            {!scripts?.hasPackageJson
              ? "No package.json in this project"
              : "No scripts defined in package.json"}
          </div>
        )}

        {loading && (
          <div style={{ padding: 20, textAlign: "center" }}>
            <Loader2 size={16} className="animate-spin" style={{ color: "hsl(207 90% 60%)" }} />
          </div>
        )}
      </div>

      {/* Footer info */}
      <div style={{
        padding: "6px 10px", borderTop: "1px solid hsl(220 13% 22%)",
        fontSize: 10, color: "hsl(220 14% 45%)",
      }}>
        Click any task to run it in a new system shell
      </div>
    </div>
  );
}
