import { useState, useMemo, useEffect, useRef } from "react";
import {
  FilePlus, FolderOpen, GitBranch, Sparkles,
  Zap, MessageSquare, ChevronRight, BookOpen,
} from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useActiveProject } from "@/contexts/ProjectContext";
import { FolderPicker } from "./FolderPicker";
import { CloneRepoModal } from "./CloneRepoModal";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

interface WelcomePageProps {
  onOpenPreview?: () => void;
  onNewFile?: () => void;
}

const LOGO_URL = "/logo.png";
const F = { d: FONTS.display, m: FONTS.mono, s: FONTS.sans };

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

export function WelcomePage({ onOpenPreview, onNewFile }: WelcomePageProps) {
  const { projects, openFolder, switchProject, createProject } = useProjects();
  const { activeProjectId } = useActiveProject();
  const [showOpenFolder, setShowOpenFolder] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileError, setNewFileError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const generateTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [logoLoaded, setLogoLoaded] = useState(false);

  useEffect(() => { injectFonts(); }, []);

  const recentProjects = useMemo(() => {
    return [...projects]
      .filter((p) => p.id !== activeProjectId)
      .sort((a, b) => {
        const ta = a.updatedAt instanceof Date ? a.updatedAt.getTime() : new Date(a.updatedAt).getTime();
        const tb = b.updatedAt instanceof Date ? b.updatedAt.getTime() : new Date(b.updatedAt).getTime();
        return tb - ta;
      })
      .slice(0, 5);
  }, [projects, activeProjectId]);

  const handleCreateNewFile = () => {
    const name = newFileName.trim().replace(/^\/+/, "");
    if (!name) { setNewFileError("Enter a file name"); return; }
    if (!activeProjectId) { setNewFileError("Open or create a project first."); return; }
    if (/[<>:"|?*]/.test(name)) { setNewFileError("Invalid characters"); return; }
    if (name.includes("..")) { setNewFileError("Path may not contain .."); return; }
    window.dispatchEvent(new CustomEvent("pipilot:new-file", { detail: { path: name, content: "" } }));
    setShowNewFile(false);
    setNewFileName("");
  };

  const handleGenerate = async () => {
    const prompt = generatePrompt.trim();
    if (!prompt) { setGenerateError("Describe what you want to build"); return; }
    setGenerating(true);
    setGenerateError(null);
    try {
      const { generateProjectFolderName } = await import("@/lib/a0llm");
      const nameFromPrompt = await generateProjectFolderName(prompt);
      await createProject(nameFromPrompt, "static", "blank");
      window.dispatchEvent(new CustomEvent("pipilot:open-chat"));
      setShowGenerate(false);
      setGeneratePrompt("");

      // Wait for the chat session to initialize for the new project.
      // useAgentChat emits "pipilot:chat-session-ready" after the
      // session ID is set and the IndexedDB row is created.
      await new Promise<void>((resolve) => {
        const onReady = () => {
          window.removeEventListener("pipilot:chat-session-ready", onReady);
          resolve();
        };
        window.addEventListener("pipilot:chat-session-ready", onReady);
        // Fallback timeout in case the event never fires
        setTimeout(() => {
          window.removeEventListener("pipilot:chat-session-ready", onReady);
          resolve();
        }, 3000);
      });

      // One more tick for React to commit the state update
      await new Promise((r) => setTimeout(r, 200));
      window.dispatchEvent(new CustomEvent("pipilot:focus-chat-input", { detail: { prefill: prompt, submit: true } }));
    } catch (err: any) {
      setGenerateError(err?.message || "Failed to start project");
    } finally {
      setGenerating(false);
    }
  };

  const openWalkthrough = (id: string) => {
    window.dispatchEvent(new CustomEvent("pipilot:open-walkthrough", { detail: { id } }));
  };

  return (
    <div
      data-testid="editor-empty-state"
      style={{
        flex: 1, position: "relative", overflow: "hidden auto",
        background: C.bg, color: C.text, fontFamily: F.s, minHeight: 0,
      }}
    >
      {/* Subtle radial glow */}
      <div aria-hidden style={{
        position: "absolute", top: -80, left: "50%", transform: "translateX(-50%)",
        width: 800, height: 400,
        background: `radial-gradient(ellipse at center, ${C.accent}06 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />

      <div style={{ position: "relative", maxWidth: 680, margin: "0 auto", padding: "48px 40px 60px" }}>

        {/* ── Logo + Title ── */}
        <header style={{
          display: "flex", alignItems: "center", gap: 16, marginBottom: 40,
          animation: "wFadeIn 0.45s cubic-bezier(0.16, 1, 0.3, 1)",
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: 11, overflow: "hidden",
            background: logoLoaded ? "transparent" : C.surface,
            border: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
            boxShadow: `0 4px 16px -4px #00000040`,
          }}>
            <img
              src={LOGO_URL} alt="PiPilot" onLoad={() => setLogoLoaded(true)}
              style={{ width: "72%", height: "72%", objectFit: "contain", opacity: logoLoaded ? 1 : 0, transition: "opacity 0.3s" }}
            />
          </div>
          <div>
            <h1 style={{ fontFamily: F.d, fontSize: 22, fontWeight: 400, lineHeight: 1.1, color: C.text, margin: 0 }}>
              PiPilot IDE
            </h1>
          </div>
        </header>

        {/* ── Two-column: Start + Recent ── */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, marginBottom: 36,
          animation: "wFadeIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) 0.04s backwards",
        }}>
          {/* Start */}
          <div>
            <SectionTitle>Start</SectionTitle>
            <NavList>
              <NavLink icon={<FilePlus size={14} />} onClick={() => {
                if (onNewFile) { onNewFile(); return; }
                setNewFileError(!activeProjectId ? "Open or create a project first." : null);
                setNewFileName(""); setShowNewFile(true);
              }}>New File...</NavLink>
              <NavLink icon={<FolderOpen size={14} />} onClick={() => setShowOpenFolder(true)}>Open Folder...</NavLink>
              <NavLink icon={<GitBranch size={14} />} onClick={() => setShowClone(true)}>Clone Repository...</NavLink>
              <NavLink icon={<Sparkles size={14} />} accent onClick={() => {
                setGeneratePrompt(""); setGenerateError(null); setShowGenerate(true);
                setTimeout(() => generateTextareaRef.current?.focus(), 80);
              }}>Generate with AI...</NavLink>
            </NavList>
          </div>

          {/* Recent */}
          <div>
            <SectionTitle>Recent</SectionTitle>
            {recentProjects.length === 0 ? (
              <p style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, margin: 0 }}>
                No recent projects.{" "}
                <button type="button" onClick={() => setShowOpenFolder(true)} style={{
                  background: "none", border: "none", padding: 0, color: "hsl(207 90% 68%)",
                  cursor: "pointer", fontFamily: "inherit", fontSize: "inherit",
                }}>Open a folder</button> to start.
              </p>
            ) : (
              <NavList>
                {recentProjects.map((p) => (
                  <button
                    key={p.id} type="button" onClick={() => switchProject(p.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "5px 8px", marginLeft: -8, width: "calc(100% + 16px)",
                      background: "transparent", border: "none",
                      color: C.textMid, fontFamily: F.s, fontSize: 12.5,
                      cursor: "pointer", borderRadius: 4, textAlign: "left",
                      transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.color = C.text; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textMid; }}
                  >
                    <FolderOpen size={12} style={{ opacity: 0.45, flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <span style={{ fontFamily: F.m, fontSize: 9, color: C.textDim, flexShrink: 0 }}>{relativeTime(p.updatedAt)}</span>
                  </button>
                ))}
              </NavList>
            )}
          </div>
        </div>

        {/* ── Walkthroughs ── */}
        <div style={{ animation: "wFadeIn 0.45s cubic-bezier(0.16, 1, 0.3, 1) 0.08s backwards" }}>
          <SectionTitle>Walkthroughs</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <WalkthroughCard
              icon={<Zap size={18} />}
              gradient="hsl(220 13% 22%)"
              title="Get Started with PiPilot"
              description="Set up your workspace, navigate the editor, and learn the essentials"
              steps={6}
              storageKey="pipilot-wt-get-started"
              onClick={() => openWalkthrough("get-started")}
            />
            <WalkthroughCard
              icon={<MessageSquare size={18} />}
              gradient="hsl(220 13% 22%)"
              title="AI Power User"
              description="Use the AI agent to generate, edit, refactor, and deploy your projects"
              steps={6}
              storageKey="pipilot-wt-ai-power"
              onClick={() => openWalkthrough("ai-power")}
            />
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      <FolderPicker open={showOpenFolder} onClose={() => setShowOpenFolder(false)} onPick={async (path) => { await openFolder(path); }} />
      <CloneRepoModal open={showClone} onClose={() => setShowClone(false)} onCloned={async (path) => { await openFolder(path); }} />

      {showNewFile && (
        <ModalBackdrop onClose={() => setShowNewFile(false)}>
          <ModalCard title="New File" subtitle="Create a file in the current project">
            <input type="text" autoFocus value={newFileName}
              onChange={(e) => { setNewFileName(e.target.value); setNewFileError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateNewFile(); if (e.key === "Escape") setShowNewFile(false); }}
              placeholder="src/index.ts"
              style={{
                width: "100%", padding: "10px 12px", fontFamily: F.m, fontSize: 12,
                background: C.bg, color: C.text,
                border: `1px solid ${newFileError ? "#ff6b6b55" : C.border}`,
                borderRadius: 5, outline: "none", marginBottom: 10,
              }}
            />
            {newFileError && <ErrorBar>{newFileError}</ErrorBar>}
            <ModalActions>
              <ModalBtn onClick={() => setShowNewFile(false)}>Cancel</ModalBtn>
              <ModalBtn primary onClick={handleCreateNewFile} disabled={!newFileName.trim() || !activeProjectId}>Create</ModalBtn>
            </ModalActions>
          </ModalCard>
        </ModalBackdrop>
      )}

      {showGenerate && (
        <ModalBackdrop onClose={() => !generating && setShowGenerate(false)}>
          <ModalCard title="Generate with AI" subtitle="Describe what you want and PiPilot will scaffold it" wide>
            <textarea ref={generateTextareaRef} value={generatePrompt} rows={4}
              onChange={(e) => { setGeneratePrompt(e.target.value); setGenerateError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !generating) { e.preventDefault(); handleGenerate(); }
                if (e.key === "Escape" && !generating) setShowGenerate(false);
              }}
              placeholder="A retro-arcade landing page for a synthwave music label\u2026"
              style={{
                width: "100%", padding: "12px 14px", fontFamily: F.s, fontSize: 13,
                background: C.bg, color: C.text,
                border: `1px solid ${generateError ? "#ff6b6b55" : C.border}`,
                borderRadius: 5, outline: "none", resize: "vertical",
                marginBottom: 10, lineHeight: 1.5,
              }}
            />
            {generateError && <ErrorBar>{generateError}</ErrorBar>}
            <ModalActions>
              <span style={{ fontFamily: F.m, fontSize: 9, color: C.textDim }}>{generatePrompt.length} chars</span>
              <div style={{ display: "flex", gap: 8 }}>
                <ModalBtn onClick={() => setShowGenerate(false)} disabled={generating}>Cancel</ModalBtn>
                <ModalBtn primary onClick={handleGenerate} disabled={!generatePrompt.trim() || generating}>
                  {generating ? "Starting\u2026" : "Generate \u2192"}
                </ModalBtn>
              </div>
            </ModalActions>
          </ModalCard>
        </ModalBackdrop>
      )}

      <style>{`
        @keyframes wFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontFamily: F.s, fontSize: 11, fontWeight: 700, color: C.text,
      textTransform: "uppercase", letterSpacing: "0.06em",
      margin: "0 0 10px",
    }}>{children}</h2>
  );
}

function NavList({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>;
}

function NavLink({ children, icon, onClick, accent }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void; accent?: boolean }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "5px 8px", marginLeft: -8, width: "calc(100% + 16px)",
      background: "transparent", border: "none",
      color: accent ? C.accent : "hsl(207 90% 68%)",
      fontFamily: F.s, fontSize: 12.5, cursor: "pointer",
      borderRadius: 4, transition: "background 0.12s", textAlign: "left",
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ opacity: 0.6, flexShrink: 0 }}>{icon}</span>
      {children}
    </button>
  );
}

function WalkthroughCard({ icon, gradient, title, description, steps, storageKey, onClick }: {
  icon: React.ReactNode; gradient: string; title: string; description: string;
  steps: number; storageKey: string; onClick: () => void;
}) {
  const [doneCount, setDoneCount] = useState(0);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setDoneCount(new Set(JSON.parse(saved)).size);
    } catch {}
  }, [storageKey]);

  const progress = steps > 0 ? doneCount / steps : 0;
  const allDone = doneCount >= steps;

  return (
    <button
      type="button" onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "14px 16px", width: "100%",
        background: "transparent",
        border: `1px solid ${C.border}`,
        borderRadius: 8, cursor: "pointer",
        textAlign: "left",
        transition: "all 0.15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = C.surface; e.currentTarget.style.borderColor = C.borderHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = C.border; }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 8, background: gradient,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: C.accent, flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: F.s, fontSize: 13, fontWeight: 600, color: C.text }}>{title}</div>
        <div style={{ fontFamily: F.s, fontSize: 11, color: C.textDim, marginTop: 2 }}>{description}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <div style={{ width: 40, height: 3, borderRadius: 2, background: C.surfaceAlt, overflow: "hidden" }}>
          <div style={{ width: `${progress * 100}%`, height: "100%", background: allDone ? "#22c55e" : C.accent, borderRadius: 2, transition: "width 0.3s" }} />
        </div>
        <span style={{ fontFamily: F.m, fontSize: 9, color: C.textDim }}>{doneCount}/{steps}</span>
        <ChevronRight size={14} style={{ color: C.textDim }} />
      </div>
    </button>
  );
}

function ModalBackdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.s,
    }}>{children}</div>
  );
}

function ModalCard({ children, title, subtitle, wide }: { children: React.ReactNode; title: string; subtitle: string; wide?: boolean }) {
  return (
    <div style={{
      width: wide ? 600 : 480, maxWidth: "92vw",
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: 28, boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
    }}>
      <h3 style={{ fontFamily: F.s, fontSize: 16, fontWeight: 600, color: C.text, margin: "0 0 4px" }}>{title}</h3>
      <p style={{ fontSize: 12, color: C.textDim, margin: "0 0 18px", lineHeight: 1.5 }}>{subtitle}</p>
      {children}
    </div>
  );
}

function ModalActions({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, marginTop: 8 }}>{children}</div>;
}

function ModalBtn({ children, onClick, primary, disabled }: { children: React.ReactNode; onClick?: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      padding: "8px 16px", fontFamily: F.m, fontSize: 10, fontWeight: primary ? 600 : 500,
      letterSpacing: "0.08em", textTransform: "uppercase",
      background: primary && !disabled ? C.accent : "transparent",
      color: primary && !disabled ? C.bg : disabled ? C.textFaint : C.textMid,
      border: `1px solid ${primary && !disabled ? C.accent : C.border}`,
      borderRadius: 4, cursor: disabled ? "not-allowed" : "pointer",
    }}>{children}</button>
  );
}

function ErrorBar({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: "8px 12px", marginBottom: 10, fontSize: 11, fontFamily: F.m,
      color: "#ff9b9b", background: "#ff6b6b12", border: "1px solid #ff6b6b33", borderRadius: 4,
    }}>{children}</div>
  );
}
