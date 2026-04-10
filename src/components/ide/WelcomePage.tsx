import { useState, useMemo } from "react";
import {
  FilePlus, FolderOpen, GitBranch, Sparkles, FileText, Globe,
  Folder, Clock, X, Plus, Loader2, ExternalLink, Hash,
} from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useActiveProject } from "@/contexts/ProjectContext";
import { FolderPicker } from "./FolderPicker";

interface WelcomePageProps {
  onOpenPreview?: () => void;
  onNewFile?: () => void;
}

const COLORS = {
  bg: "hsl(220 13% 14%)",
  text: "hsl(220 14% 88%)",
  textMuted: "hsl(220 14% 55%)",
  textDim: "hsl(220 14% 38%)",
  accent: "hsl(207 90% 60%)",
  accentDim: "hsl(207 90% 50% / 0.15)",
  border: "hsl(220 13% 24%)",
  hoverBg: "hsl(220 13% 18%)",
};

export function WelcomePage({ onOpenPreview, onNewFile }: WelcomePageProps) {
  const { projects, openFolder, switchProject } = useProjects();
  const { activeProjectId } = useActiveProject();
  const [showOpenFolder, setShowOpenFolder] = useState(false);

  // Recent projects: sorted by updatedAt desc, exclude active, top 8
  const recentProjects = useMemo(() => {
    return [...projects]
      .filter((p) => p.id !== activeProjectId)
      .sort((a, b) => {
        const ta = a.updatedAt instanceof Date ? a.updatedAt.getTime() : new Date(a.updatedAt).getTime();
        const tb = b.updatedAt instanceof Date ? b.updatedAt.getTime() : new Date(b.updatedAt).getTime();
        return tb - ta;
      })
      .slice(0, 8);
  }, [projects, activeProjectId]);

  const handlePickFolder = async (absolutePath: string) => {
    await openFolder(absolutePath);
  };

  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ background: COLORS.bg, color: COLORS.text }}
      data-testid="editor-empty-state"
    >
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "60px 48px" }}>
        {/* Brand header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
          <div
            style={{
              width: 56, height: 56, borderRadius: 14,
              background: "linear-gradient(135deg, hsl(207 90% 50%), hsl(280 75% 55%))",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 16px hsl(207 90% 30% / 0.4)",
            }}
          >
            <Sparkles size={28} style={{ color: "#fff" }} />
          </div>
          <div>
            <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0 }}>PiPilot</h1>
            <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "2px 0 0 0" }}>
              AI-powered web IDE
            </p>
          </div>
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 48,
          marginTop: 48,
        }}>
          {/* ── Start ── */}
          <section>
            <h2 style={{
              fontSize: 18, fontWeight: 600, marginBottom: 16,
              color: COLORS.text,
            }}>
              Start
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {onNewFile && (
                <ActionRow
                  icon={<FilePlus size={16} style={{ color: COLORS.accent }} />}
                  label="New File..."
                  onClick={onNewFile}
                />
              )}
              <ActionRow
                icon={<FolderOpen size={16} style={{ color: COLORS.accent }} />}
                label="Open Folder..."
                onClick={() => setShowOpenFolder(true)}
              />
              {onOpenPreview && (
                <ActionRow
                  icon={<Globe size={16} style={{ color: "hsl(142 71% 55%)" }} />}
                  label="Open Web Preview"
                  onClick={onOpenPreview}
                />
              )}
              <ActionRow
                icon={<GitBranch size={16} style={{ color: COLORS.accent }} />}
                label="Clone Git Repository..."
                onClick={() => {
                  // Open terminal with git clone command
                  window.dispatchEvent(new CustomEvent("pipilot:run-in-terminal", {
                    detail: { command: "git clone ", label: "git clone" },
                  }));
                }}
              />
              <ActionRow
                icon={<Sparkles size={16} style={{ color: "hsl(280 75% 65%)" }} />}
                label="Generate New Workspace..."
                description="Ask the AI to scaffold a project for you"
                onClick={() => {
                  // Open AI chat
                  window.dispatchEvent(new CustomEvent("pipilot:open-chat"));
                }}
              />
            </div>
          </section>

          {/* ── Recent ── */}
          <section>
            <h2 style={{
              fontSize: 18, fontWeight: 600, marginBottom: 16,
              color: COLORS.text,
            }}>
              Recent
            </h2>
            {recentProjects.length === 0 ? (
              <p style={{ fontSize: 12, color: COLORS.textDim }}>
                You have no recent projects.{" "}
                <button
                  onClick={() => setShowOpenFolder(true)}
                  style={{
                    background: "none", border: "none", color: COLORS.accent,
                    cursor: "pointer", padding: 0, fontSize: 12,
                    textDecoration: "underline",
                  }}
                >
                  Open a folder
                </button>{" "}
                to start.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {recentProjects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => switchProject(p.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 10px", fontSize: 12,
                      background: "transparent", color: COLORS.text,
                      border: "1px solid transparent", borderRadius: 6,
                      cursor: "pointer", textAlign: "left",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = COLORS.hoverBg;
                      e.currentTarget.style.borderColor = COLORS.border;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.borderColor = "transparent";
                    }}
                  >
                    <Folder size={14} style={{ color: "hsl(38 92% 60%)", flexShrink: 0 }} />
                    <span style={{ flex: 1, fontWeight: 500 }}>{p.name}</span>
                    {p.type === "linked" && p.linkedPath && (
                      <span style={{ fontSize: 10, color: COLORS.textDim, fontFamily: "monospace", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.linkedPath}
                      </span>
                    )}
                    {p.type !== "linked" && (
                      <span style={{
                        fontSize: 9, padding: "1px 5px", borderRadius: 3,
                        background: COLORS.accentDim, color: COLORS.accent,
                        fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4,
                      }}>
                        {p.type}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Tips */}
        <div style={{
          marginTop: 64,
          padding: "16px 20px",
          borderRadius: 8,
          background: "hsl(220 13% 16%)",
          border: `1px solid ${COLORS.border}`,
        }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, marginBottom: 10 }}>
            Keyboard shortcuts
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 24px", fontSize: 11 }}>
            <ShortcutRow keys={["Ctrl", "P"]} description="Quick file open" />
            <ShortcutRow keys={["Ctrl", "Shift", "P"]} description="Command palette" />
            <ShortcutRow keys={["Ctrl", "Shift", "I"]} description="Toggle AI chat" />
            <ShortcutRow keys={["Ctrl", "`"]} description="Toggle terminal" />
            <ShortcutRow keys={["Ctrl", "B"]} description="Toggle sidebar" />
            <ShortcutRow keys={["Ctrl", ","]} description="Open settings" />
            <ShortcutRow keys={["Tab"]} description="Accept AI suggestion" />
            <ShortcutRow keys={["Ctrl", "S"]} description="Save file" />
          </div>
        </div>
      </div>

      {/* Open Folder picker (browses real disk via server endpoint) */}
      <FolderPicker
        open={showOpenFolder}
        onClose={() => setShowOpenFolder(false)}
        onPick={handlePickFolder}
      />
    </div>
  );
}

function ActionRow({ icon, label, description, onClick }: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 12px", fontSize: 13,
        background: "transparent", color: COLORS.accent,
        border: "1px solid transparent", borderRadius: 6,
        cursor: "pointer", textAlign: "left",
        transition: "background 0.12s, border-color 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = COLORS.hoverBg;
        e.currentTarget.style.borderColor = COLORS.border;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      {icon}
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500 }}>{label}</div>
        {description && (
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>{description}</div>
        )}
      </div>
    </button>
  );
}

function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: COLORS.textMuted }}>{description}</span>
      <div style={{ display: "flex", gap: 3 }}>
        {keys.map((k) => (
          <kbd
            key={k}
            style={{
              padding: "1px 6px", fontSize: 9, fontFamily: "monospace",
              background: "hsl(220 13% 22%)", color: COLORS.text,
              border: `1px solid ${COLORS.border}`, borderRadius: 3,
              boxShadow: "0 1px 0 hsl(220 13% 8%)",
            }}
          >
            {k}
          </kbd>
        ))}
      </div>
    </div>
  );
}
