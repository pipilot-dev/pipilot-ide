import { useState, useMemo, useEffect } from "react";
import {
  FilePlus, FolderOpen, GitBranch, Sparkles, Globe, ArrowUpRight,
} from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useActiveProject } from "@/contexts/ProjectContext";
import { FolderPicker } from "./FolderPicker";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

interface WelcomePageProps {
  onOpenPreview?: () => void;
  onNewFile?: () => void;
}

const LOGO_URL = "https://pipilot.dev/logo.png";
const FONT_DISPLAY = FONTS.display;
const FONT_MONO = FONTS.mono;
const FONT_SANS = FONTS.sans;

// Format the current date as "10 APR 2026"
function formatBuildDate(): string {
  const d = new Date();
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function relativeTime(date: Date | string): string {
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const diff = Date.now() - t;
  const min = 60_000, hour = 3600_000, day = 86400_000;
  if (diff < min) return "just now";
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < day * 7) return `${Math.floor(diff / day)}d ago`;
  if (diff < day * 30) return `${Math.floor(diff / (day * 7))}w ago`;
  return `${Math.floor(diff / (day * 30))}mo ago`;
}

interface ActionDef {
  index: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
}

export function WelcomePage({ onOpenPreview, onNewFile }: WelcomePageProps) {
  const { projects, openFolder, switchProject } = useProjects();
  const { activeProjectId } = useActiveProject();
  const [showOpenFolder, setShowOpenFolder] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [logoLoaded, setLogoLoaded] = useState(false);
  const buildDate = useMemo(formatBuildDate, []);

  useEffect(() => { injectFonts(); }, []);

  const recentProjects = useMemo(() => {
    return [...projects]
      .filter((p) => p.id !== activeProjectId)
      .sort((a, b) => {
        const ta = a.updatedAt instanceof Date ? a.updatedAt.getTime() : new Date(a.updatedAt).getTime();
        const tb = b.updatedAt instanceof Date ? b.updatedAt.getTime() : new Date(b.updatedAt).getTime();
        return tb - ta;
      })
      .slice(0, 6);
  }, [projects, activeProjectId]);

  const actions: ActionDef[] = [
    {
      index: "01",
      label: "Open a folder",
      hint: "Browse your disk and start working in any directory.",
      icon: <FolderOpen size={14} />,
      shortcut: "⌘O",
      onClick: () => setShowOpenFolder(true),
    },
    {
      index: "02",
      label: "New file",
      hint: "Create a blank file in the current project.",
      icon: <FilePlus size={14} />,
      onClick: () => onNewFile?.() ?? null,
    },
    {
      index: "03",
      label: "Open web preview",
      hint: "Launch the dev server preview for the active project.",
      icon: <Globe size={14} />,
      onClick: () => onOpenPreview?.() ?? null,
    },
    {
      index: "04",
      label: "Clone a repository",
      hint: "Pull a git repo and open it as a workspace.",
      icon: <GitBranch size={14} />,
      onClick: () => {
        setCloneError(null);
        setCloneUrl("");
        setShowClone(true);
      },
    },
    {
      index: "05",
      label: "Generate with AI",
      hint: "Describe what you want and let PiPilot scaffold it.",
      icon: <Sparkles size={14} />,
      shortcut: "⌘⇧I",
      onClick: () => {
        // Open the chat panel AND focus the textarea so users can
        // immediately start typing their prompt.
        window.dispatchEvent(new CustomEvent("pipilot:open-chat"));
        // Slight delay so the panel actually mounts before we focus
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("pipilot:focus-chat-input"));
        }, 150);
      },
    },
  ];

  /**
   * Clone a remote git repository via a server endpoint, then auto-open
   * the cloned folder as a linked workspace.
   */
  const handleClone = async () => {
    const url = cloneUrl.trim();
    if (!url) return;
    // Basic validation
    if (!/^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/i.test(url)) {
      setCloneError("URL must start with https://, git@, ssh://, or git://");
      return;
    }
    setCloning(true);
    setCloneError(null);
    try {
      const res = await fetch("/api/git/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.message || "Clone failed");
      }
      // data.path is the absolute path of the cloned folder
      if (data.path) {
        await openFolder(data.path);
      }
      setShowClone(false);
      setCloneUrl("");
    } catch (err: any) {
      setCloneError(err.message || "Clone failed");
    } finally {
      setCloning(false);
    }
  };

  return (
    <div
      data-testid="editor-empty-state"
      style={{
        flex: 1,
        position: "relative",
        overflow: "hidden auto",
        background: C.bg,
        color: C.text,
        fontFamily: FONT_SANS,
        minHeight: 0,
      }}
    >
      {/* ── Atmospheric background layers ── */}
      {/* Radial glow accent */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -160, right: -200,
          width: 720, height: 720,
          background: `radial-gradient(circle at center, ${C.accent}10 0%, transparent 60%)`,
          filter: "blur(20px)",
          pointerEvents: "none",
        }}
      />
      {/* Dot grid */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `radial-gradient(circle, #ffffff08 1px, transparent 1px)`,
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 30%, black 30%, transparent 100%)",
          pointerEvents: "none",
        }}
      />
      {/* SVG noise grain */}
      <svg
        aria-hidden
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          opacity: 0.04, mixBlendMode: "overlay",
          pointerEvents: "none",
        }}
      >
        <filter id="welcome-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#welcome-noise)" />
      </svg>

      {/* ── Top metadata strip ── */}
      <div
        style={{
          position: "relative",
          display: "flex", alignItems: "center", gap: 16,
          padding: "18px 56px",
          fontFamily: FONT_MONO,
          fontSize: 10, fontWeight: 400, letterSpacing: "0.15em",
          color: C.textDim, textTransform: "uppercase",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <span style={{ color: C.accent }}>●</span>
        <span>PIPILOT IDE</span>
        <span style={{ color: C.textFaint }}>/</span>
        <span>v0.1.0</span>
        <span style={{ color: C.textFaint }}>/</span>
        <span>{buildDate}</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: C.textDim }}>// AI-NATIVE WEB IDE</span>
      </div>

      {/* ── Main editorial spread ── */}
      <div style={{ position: "relative", padding: "64px 56px 48px", maxWidth: 1180, margin: "0 auto" }}>
        {/* Hero — logo + display heading */}
        <header
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: 32,
            alignItems: "start",
            marginBottom: 88,
            animation: "welcomeFadeIn 0.7s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <div
            style={{
              width: 92, height: 92,
              background: logoLoaded ? "transparent" : C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 18,
              display: "flex", alignItems: "center", justifyContent: "center",
              overflow: "hidden",
              flexShrink: 0,
              boxShadow: `0 0 0 1px ${C.border}, 0 24px 60px -12px #00000080`,
            }}
          >
            <img
              src={LOGO_URL}
              alt="PiPilot"
              onLoad={() => setLogoLoaded(true)}
              style={{
                width: "78%", height: "78%",
                objectFit: "contain",
                opacity: logoLoaded ? 1 : 0,
                transition: "opacity 0.4s ease",
              }}
            />
          </div>

          <div style={{ paddingTop: 4 }}>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11, fontWeight: 400,
                color: C.accent, letterSpacing: "0.1em", textTransform: "uppercase",
                marginBottom: 12,
              }}
            >
              <span style={{ color: C.textDim }}>// </span>
              welcome back
            </div>
            <h1
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: "clamp(54px, 7vw, 96px)",
                fontWeight: 400,
                lineHeight: 0.95,
                letterSpacing: "-0.025em",
                color: C.text,
                margin: 0,
              }}
            >
              what shall we{" "}
              <span style={{ fontStyle: "italic", color: C.accent }}>build</span>
              <span style={{ color: C.accent }}>.</span>
            </h1>
            <p
              style={{
                marginTop: 24,
                fontFamily: FONT_SANS,
                fontSize: 14,
                color: C.textMid,
                lineHeight: 1.6,
                maxWidth: 540,
              }}
            >
              An editor that thinks with you. Type, ask, generate, refactor, deploy —
              all in one workspace, all on your real disk.
            </p>
          </div>
        </header>

        {/* ── Asymmetric two-column body ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.45fr) minmax(0, 1fr)",
            gap: 72,
            animation: "welcomeFadeIn 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s backwards",
          }}
        >
          {/* LEFT: numbered actions */}
          <section>
            <SectionLabel index="A" label="Get started" />
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {actions.map((a, i) => (
                <ActionItem key={a.index} action={a} isLast={i === actions.length - 1} />
              ))}
            </ol>
          </section>

          {/* RIGHT: recent projects */}
          <section>
            <SectionLabel index="B" label="Recent" count={recentProjects.length} />
            {recentProjects.length === 0 ? (
              <p
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 13,
                  color: C.textDim,
                  lineHeight: 1.6,
                  margin: "8px 0 0 0",
                }}
              >
                Nothing yet. <button
                  onClick={() => setShowOpenFolder(true)}
                  style={{
                    background: "none", border: "none", padding: 0,
                    color: C.accent, cursor: "pointer",
                    fontFamily: "inherit", fontSize: "inherit",
                    borderBottom: `1px solid ${C.accent}`,
                  }}
                >
                  Open a folder
                </button> to start.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {recentProjects.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => switchProject(p.id)}
                      style={{
                        width: "100%",
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        alignItems: "baseline",
                        gap: 12,
                        padding: "16px 0",
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid ${C.border}`,
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "padding 0.2s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.paddingLeft = "8px";
                        const h2 = e.currentTarget.querySelector("[data-pname]") as HTMLElement;
                        if (h2) h2.style.color = C.accent;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.paddingLeft = "0px";
                        const h2 = e.currentTarget.querySelector("[data-pname]") as HTMLElement;
                        if (h2) h2.style.color = C.text;
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          data-pname
                          style={{
                            fontFamily: FONT_DISPLAY,
                            fontSize: 22,
                            fontWeight: 400,
                            color: C.text,
                            lineHeight: 1.1,
                            transition: "color 0.18s",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {p.name}
                        </div>
                        <div
                          style={{
                            marginTop: 6,
                            fontFamily: FONT_MONO,
                            fontSize: 10,
                            color: C.textDim,
                            letterSpacing: "0.05em",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {p.type === "linked" && p.linkedPath ? (
                            <span title={p.linkedPath}>{shortenPath(p.linkedPath)}</span>
                          ) : (
                            <span>{p.template || p.type}</span>
                          )}
                        </div>
                      </div>
                      <div
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: 10,
                          color: C.textDim,
                          letterSpacing: "0.05em",
                          flexShrink: 0,
                        }}
                      >
                        {relativeTime(p.updatedAt)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── Bottom shortcut strip ── */}
        <footer
          style={{
            marginTop: 88,
            paddingTop: 24,
            borderTop: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", flexWrap: "wrap", gap: 24,
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.textDim,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            animation: "welcomeFadeIn 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.2s backwards",
          }}
        >
          {[
            { keys: "⌘P", label: "quick open" },
            { keys: "⌘⇧I", label: "ai chat" },
            { keys: "⌘`", label: "terminal" },
            { keys: "⌘B", label: "sidebar" },
            { keys: "⌘,", label: "settings" },
            { keys: "Tab", label: "accept ai" },
          ].map((s, i) => (
            <span key={s.keys} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <kbd
                style={{
                  padding: "2px 7px",
                  background: C.surface,
                  color: C.text,
                  border: `1px solid ${C.border}`,
                  borderRadius: 3,
                  fontFamily: FONT_MONO,
                  fontSize: 10,
                  letterSpacing: 0,
                }}
              >
                {s.keys}
              </kbd>
              <span>{s.label}</span>
              {i < 5 && <span style={{ color: C.textFaint, marginLeft: 18 }}>·</span>}
            </span>
          ))}
        </footer>
      </div>

      {/* Folder picker modal */}
      <FolderPicker
        open={showOpenFolder}
        onClose={() => setShowOpenFolder(false)}
        onPick={async (path) => { await openFolder(path); }}
      />

      {/* Clone Git repo modal */}
      {showClone && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setShowClone(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0, 0, 0, 0.6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: FONT_SANS,
          }}
        >
          <div style={{
            width: 560,
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: 28,
            boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 9, fontWeight: 500,
                  letterSpacing: "0.18em", textTransform: "uppercase",
                  color: C.accent,
                }}
              >
                / 04
              </span>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 9, fontWeight: 500,
                  letterSpacing: "0.18em", textTransform: "uppercase",
                  color: C.textDim,
                }}
              >
                Clone Repository
              </span>
            </div>

            <h3
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 32,
                fontWeight: 400,
                lineHeight: 1.05,
                color: C.text,
                margin: "0 0 16px 0",
              }}
            >
              pull a <span style={{ fontStyle: "italic", color: C.accent }}>repo</span>
              <span style={{ color: C.accent }}>.</span>
            </h3>

            <p style={{ fontSize: 12, color: C.textMid, lineHeight: 1.6, margin: "0 0 18px 0" }}>
              Enter a git URL. PiPilot will clone it and open the folder as a workspace.
            </p>

            <input
              type="text"
              autoFocus
              value={cloneUrl}
              onChange={(e) => { setCloneUrl(e.target.value); setCloneError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !cloning) handleClone();
                if (e.key === "Escape") setShowClone(false);
              }}
              placeholder="https://github.com/user/repo.git"
              style={{
                width: "100%", padding: "10px 14px",
                fontFamily: FONT_MONO, fontSize: 12,
                background: "#0a0a0d",
                color: C.text,
                border: `1px solid ${cloneError ? "#ff6b6b55" : C.border}`,
                borderRadius: 5, outline: "none",
                marginBottom: 10,
              }}
            />

            {cloneError && (
              <div style={{
                padding: "8px 12px", marginBottom: 10,
                fontSize: 11, fontFamily: FONT_MONO,
                color: "#ff9b9b",
                background: "#ff6b6b12",
                border: `1px solid #ff6b6b33`,
                borderRadius: 4,
              }}>
                {cloneError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
              <button
                onClick={() => setShowClone(false)}
                disabled={cloning}
                style={{
                  padding: "8px 16px",
                  fontFamily: FONT_MONO, fontSize: 10, fontWeight: 500,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  background: "transparent",
                  color: C.textMid,
                  border: `1px solid ${C.border}`,
                  borderRadius: 4,
                  cursor: cloning ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleClone}
                disabled={!cloneUrl.trim() || cloning}
                style={{
                  padding: "8px 18px",
                  fontFamily: FONT_MONO, fontSize: 10, fontWeight: 600,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  background: (!cloneUrl.trim() || cloning) ? C.surfaceAlt : C.accent,
                  color: (!cloneUrl.trim() || cloning) ? C.textDim : C.bg,
                  border: `1px solid ${(!cloneUrl.trim() || cloning) ? C.border : C.accent}`,
                  borderRadius: 4,
                  cursor: (!cloneUrl.trim() || cloning) ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {cloning ? "Cloning..." : "Clone →"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes welcomeFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

function SectionLabel({ index, label, count }: { index: string; label: string; count?: number }) {
  return (
    <div
      style={{
        display: "flex", alignItems: "baseline", gap: 12,
        marginBottom: 16,
        paddingBottom: 8,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          fontWeight: 500,
          color: C.accent,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        / {index}
      </span>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          fontWeight: 500,
          color: C.text,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      {typeof count === "number" && (
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.textDim,
            letterSpacing: "0.05em",
            marginLeft: "auto",
          }}
        >
          ({String(count).padStart(2, "0")})
        </span>
      )}
    </div>
  );
}

function ActionItem({ action, isLast }: { action: ActionDef; isLast: boolean }) {
  return (
    <li
      style={{
        borderBottom: isLast ? "none" : `1px solid ${C.border}`,
      }}
    >
      <button
        onClick={action.onClick}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          alignItems: "center",
          gap: 24,
          padding: "20px 0",
          background: "transparent",
          border: "none",
          textAlign: "left",
          cursor: "pointer",
          transition: "padding 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.paddingLeft = "12px";
          const num = e.currentTarget.querySelector("[data-num]") as HTMLElement;
          const arrow = e.currentTarget.querySelector("[data-arrow]") as HTMLElement;
          const label = e.currentTarget.querySelector("[data-label]") as HTMLElement;
          if (num) num.style.color = C.accent;
          if (arrow) {
            arrow.style.opacity = "1";
            arrow.style.transform = "translate(0, 0)";
            arrow.style.color = C.accent;
          }
          if (label) label.style.color = C.accent;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.paddingLeft = "0px";
          const num = e.currentTarget.querySelector("[data-num]") as HTMLElement;
          const arrow = e.currentTarget.querySelector("[data-arrow]") as HTMLElement;
          const label = e.currentTarget.querySelector("[data-label]") as HTMLElement;
          if (num) num.style.color = C.textDim;
          if (arrow) {
            arrow.style.opacity = "0";
            arrow.style.transform = "translate(-6px, 6px)";
            arrow.style.color = C.textDim;
          }
          if (label) label.style.color = C.text;
        }}
      >
        {/* Index */}
        <span
          data-num
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            fontWeight: 400,
            color: C.textDim,
            letterSpacing: "0.05em",
            transition: "color 0.18s",
          }}
        >
          {action.index}
        </span>

        {/* Label + hint */}
        <div style={{ minWidth: 0 }}>
          <div
            data-label
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 28,
              fontWeight: 400,
              color: C.text,
              lineHeight: 1.05,
              transition: "color 0.18s",
              display: "flex", alignItems: "center", gap: 14,
            }}
          >
            <span style={{ color: C.textDim, opacity: 0.6 }}>
              {action.icon}
            </span>
            {action.label}
          </div>
          <div
            style={{
              marginTop: 8,
              fontFamily: FONT_SANS,
              fontSize: 13,
              color: C.textMid,
              lineHeight: 1.5,
              maxWidth: 480,
            }}
          >
            {action.hint}
          </div>
        </div>

        {/* Arrow indicator */}
        <span
          data-arrow
          style={{
            display: "flex", alignItems: "center",
            color: C.textDim,
            opacity: 0,
            transform: "translate(-6px, 6px)",
            transition: "all 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <ArrowUpRight size={22} strokeWidth={1.5} />
        </span>
      </button>
    </li>
  );
}

function shortenPath(p: string): string {
  // Truncate path to last 2 segments, prefixed with …
  const sep = p.includes("\\") ? "\\" : "/";
  const parts = p.split(sep).filter(Boolean);
  if (parts.length <= 2) return p;
  return `…${sep}${parts.slice(-2).join(sep)}`;
}
