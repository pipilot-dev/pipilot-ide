import { useState, useMemo, useEffect, useRef } from "react";
import {
  FilePlus, FolderOpen, GitBranch, Sparkles, Upload, X, Paperclip,
  Zap, MessageSquare, ChevronRight, BookOpen,
} from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useActiveProject } from "@/contexts/ProjectContext";
import { FolderPicker } from "./FolderPicker";
import { CloneRepoModal } from "./CloneRepoModal";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";
import { apiPost } from "@/lib/api";

interface WelcomePageProps {
  onOpenPreview?: () => void;
  onNewFile?: () => void;
}

const LOGO_URL = `${import.meta.env.BASE_URL}logo.png`;
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

  // Listen for external trigger (e.g. from ChatPanel's "Generate with AI" button)
  useEffect(() => {
    const handler = () => { setGeneratePrompt(""); setGenerateError(null); setShowGenerate(true); };
    window.addEventListener("pipilot:show-generate-modal", handler);
    return () => window.removeEventListener("pipilot:show-generate-modal", handler);
  }, []);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const generateTextareaRef = useRef<HTMLTextAreaElement>(null);
  const generateFileInputRef = useRef<HTMLInputElement>(null);
  const [generateFiles, setGenerateFiles] = useState<{ name: string; path: string }[]>([]);
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

  const uploadFileToTemp = async (file: File): Promise<{ name: string; path: string } | null> => {
    try {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(file);
      });
      const data = await apiPost("/api/files/upload-temp", { fileName: file.name, base64 });
      if (data.path) return { name: file.name, path: data.path };
    } catch {}
    return null;
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
      // Build the full prompt with file references
      let fullPrompt = prompt;
      if (generateFiles.length > 0) {
        fullPrompt += "\n\n--- Attached reference files ---\n" + generateFiles.map((f) => `- ${f.name}: ${f.path}`).join("\n") + "\n\nRead these files for reference context before building.";
      }
      setGenerateFiles([]);

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
      window.dispatchEvent(new CustomEvent("pipilot:focus-chat-input", { detail: { prefill: fullPrompt, submit: true } }));
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
      {/* ── Atmospheric background layers ── */}
      {/* Warm accent glow — top left */}
      <div aria-hidden style={{
        position: "absolute", top: -180, left: -100,
        width: 700, height: 700,
        background: `radial-gradient(circle, ${C.accent}0a 0%, transparent 60%)`,
        pointerEvents: "none",
      }} />
      {/* Cool blue glow — bottom right */}
      <div aria-hidden style={{
        position: "absolute", bottom: -200, right: -100,
        width: 600, height: 600,
        background: `radial-gradient(circle, hsl(207 80% 50% / 0.04) 0%, transparent 60%)`,
        pointerEvents: "none",
      }} />
      {/* Subtle grain texture */}
      <div aria-hidden style={{
        position: "absolute", inset: 0, opacity: 0.3, pointerEvents: "none",
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`,
      }} />

      <div style={{ position: "relative", maxWidth: 720, margin: "0 auto", padding: "36px 40px 60px" }}>

        {/* ── Hero section ── */}
        <header style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          textAlign: "center", marginBottom: 44,
          animation: "wSlideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, overflow: "hidden",
            background: C.surface, border: `1px solid ${C.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 16,
            boxShadow: `0 8px 32px -8px ${C.accent}20, 0 2px 8px rgba(0,0,0,0.3)`,
          }}>
            <img src={LOGO_URL} alt="PiPilot" onLoad={() => setLogoLoaded(true)}
              style={{ width: "68%", height: "68%", objectFit: "contain", opacity: logoLoaded ? 1 : 0, transition: "opacity 0.4s" }} />
          </div>
          <h1 style={{
            fontFamily: F.d, fontSize: 28, fontWeight: 300, color: C.text,
            margin: "0 0 4px", letterSpacing: "-0.03em",
          }}>
            PiPilot <span style={{ fontWeight: 500 }}>IDE</span>
          </h1>
          <p style={{
            fontFamily: F.m, fontSize: 9, color: C.textDim,
            letterSpacing: "0.12em", textTransform: "uppercase", margin: 0,
          }}>
            ai-native code editor
          </p>
        </header>

        {/* ── Quick action cards ── */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 32,
          animation: "wSlideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.06s backwards",
        }}>
          {[
            { icon: <FolderOpen size={18} />, label: "Open Folder", color: C.info, onClick: () => setShowOpenFolder(true) },
            { icon: <GitBranch size={18} />, label: "Clone Repo", color: "#c678dd", onClick: () => setShowClone(true) },
            { icon: <Sparkles size={18} />, label: "Generate", color: C.accent, onClick: () => { setShowGenerate((p) => !p); setGenerateError(null); setTimeout(() => generateTextareaRef.current?.focus(), 80); } },
            { icon: <FilePlus size={18} />, label: "New File", color: "#98c379", onClick: () => { if (onNewFile) { onNewFile(); return; } setNewFileError(!activeProjectId || activeProjectId === "default-project" ? "Open or create a project first." : null); setNewFileName(""); setShowNewFile(true); } },
          ].map((a, i) => (
            <button key={i} type="button" onClick={a.onClick} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              padding: "18px 12px 14px", background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 10, cursor: "pointer", transition: "all 0.2s",
              color: C.text,
            }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = a.color + "60"; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 24px -4px ${a.color}15`; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
            >
              <div style={{ color: a.color, opacity: 0.85 }}>{a.icon}</div>
              <span style={{ fontFamily: F.m, fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", color: C.textMid }}>{a.label}</span>
            </button>
          ))}
        </div>

        {/* ── Recent projects ── */}
        {recentProjects.length > 0 && (
          <div style={{
            marginBottom: 32,
            animation: "wSlideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s backwards",
          }}>
            <div style={{
              fontFamily: F.m, fontSize: 9, fontWeight: 600, color: C.textDim,
              letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8,
            }}>Recent Projects</div>
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
              overflow: "hidden",
            }}>
              {recentProjects.map((p, i) => (
                <button key={p.id} type="button" onClick={() => switchProject(p.id)} style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  padding: "10px 14px",
                  background: "transparent", border: "none", borderBottom: i < recentProjects.length - 1 ? `1px solid ${C.border}` : "none",
                  color: C.text, fontFamily: F.s, fontSize: 12, cursor: "pointer",
                  textAlign: "left", transition: "background 0.15s",
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <FolderOpen size={13} style={{ color: C.accent, opacity: 0.6, flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{p.name}</span>
                  <span style={{ fontFamily: F.m, fontSize: 9, color: C.textDim, flexShrink: 0 }}>{relativeTime(p.updatedAt)}</span>
                  <ChevronRight size={12} style={{ color: C.textFaint }} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Walkthroughs ── */}
        <div style={{ animation: "wSlideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.14s backwards" }}>
          <div style={{
            fontFamily: F.m, fontSize: 9, fontWeight: 600, color: C.textDim,
            letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8,
          }}>Learn</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <WalkthroughCard
              icon={<Zap size={18} />}
              gradient={`linear-gradient(135deg, ${C.accent}18 0%, transparent 60%)`}
              title="Get Started"
              description="Workspace, editor, terminal"
              steps={6}
              storageKey="pipilot-wt-get-started"
              onClick={() => openWalkthrough("get-started")}
            />
            <WalkthroughCard
              icon={<MessageSquare size={18} />}
              gradient="linear-gradient(135deg, hsl(207 80% 50% / 0.08) 0%, transparent 60%)"
              title="AI Power User"
              description="Agent, checkpoints, deploy"
              steps={6}
              storageKey="pipilot-wt-ai-power"
              onClick={() => openWalkthrough("ai-power")}
            />
          </div>
        </div>

        {/* ── Footer tip ── */}
        <div style={{
          marginTop: 32, textAlign: "center",
          animation: "wSlideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.18s backwards",
        }}>
          <span style={{ fontFamily: F.m, fontSize: 9, color: C.textFaint }}>
            press <kbd style={{ padding: "1px 5px", background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 3, fontSize: 9, fontFamily: F.m, color: C.textDim }}>Ctrl+Shift+I</kbd> to open AI chat
          </span>
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

      {/* Inline Generate composer (replaces modal) */}
      {showGenerate && (
        <div style={{
          position: "sticky", bottom: 0, left: 0, right: 0, zIndex: 100,
          background: C.surface, borderTop: `1px solid ${C.border}`,
          padding: "14px 20px 16px",
          boxShadow: "0 -4px 16px rgba(0,0,0,0.3)",
          animation: "wSlideUp 0.3s ease",
        }}>
          <div style={{ maxWidth: 600, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Sparkles size={14} style={{ color: C.accent }} />
                <span style={{ fontFamily: F.m, fontSize: 10, fontWeight: 600, color: C.accent, letterSpacing: "0.08em", textTransform: "uppercase" }}>Generate with AI</span>
              </div>
              <button onClick={() => { if (!generating) { setShowGenerate(false); setGenerateFiles([]); } }} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 2 }}>
                <X size={14} />
              </button>
            </div>

            {/* File attachment pills */}
            {generateFiles.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                {generateFiles.map((f, i) => (
                  <span key={i} style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", borderRadius: 4,
                    background: C.surfaceAlt, border: `1px solid ${C.border}`,
                    fontFamily: F.m, fontSize: 9, color: C.textMid,
                  }}>
                    <Paperclip size={9} /> {f.name}
                    <button onClick={() => setGenerateFiles((prev) => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: C.textDim, cursor: "pointer", padding: 0 }}>
                      <X size={8} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Textarea with drag-drop */}
            <div
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = C.accent; }}
              onDragLeave={(e) => { e.currentTarget.style.borderColor = generateError ? "#ff6b6b55" : C.border; }}
              onDrop={async (e) => {
                e.preventDefault();
                e.currentTarget.style.borderColor = C.border;
                for (const file of Array.from(e.dataTransfer.files)) {
                  const uploaded = await uploadFileToTemp(file);
                  if (uploaded) setGenerateFiles((prev) => [...prev, uploaded]);
                }
              }}
              style={{
                border: `1px solid ${generateError ? "#ff6b6b55" : C.border}`,
                borderRadius: 6, overflow: "hidden", transition: "border-color 0.2s",
              }}
            >
              <textarea ref={generateTextareaRef} value={generatePrompt} rows={3}
                onChange={(e) => { setGeneratePrompt(e.target.value); setGenerateError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !generating) { e.preventDefault(); handleGenerate(); }
                  if (e.key === "Escape" && !generating) { setShowGenerate(false); setGenerateFiles([]); }
                }}
                placeholder="Describe what you want to build… (drop files here for reference)"
                style={{
                  width: "100%", padding: "10px 12px", fontFamily: F.s, fontSize: 13,
                  background: C.bg, color: C.text, border: "none",
                  outline: "none", resize: "none", lineHeight: 1.5,
                }}
              />
            </div>
            {generateError && <ErrorBar>{generateError}</ErrorBar>}

            {/* Actions */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <input type="file" ref={generateFileInputRef} style={{ display: "none" }} multiple
                onChange={async (e) => {
                  for (const file of Array.from(e.target.files || [])) {
                    const uploaded = await uploadFileToTemp(file);
                    if (uploaded) setGenerateFiles((prev) => [...prev, uploaded]);
                  }
                  e.target.value = "";
                }}
              />
              <button onClick={() => generateFileInputRef.current?.click()} style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "5px 10px", borderRadius: 4, fontSize: 9,
                fontFamily: F.m, fontWeight: 600, background: "transparent",
                border: `1px solid ${C.border}`, color: C.textMid, cursor: "pointer",
              }}>
                <Upload size={10} /> Attach files
              </button>
              <div style={{ flex: 1 }} />
              <span style={{ fontFamily: F.m, fontSize: 9, color: C.textDim }}>{generatePrompt.length} chars · {generateFiles.length} file{generateFiles.length !== 1 ? "s" : ""}</span>
              <button onClick={() => { setShowGenerate(false); setGenerateFiles([]); }} disabled={generating} style={{
                padding: "6px 14px", fontSize: 10, fontFamily: F.m, fontWeight: 500,
                background: "transparent", color: C.textMid, border: `1px solid ${C.border}`,
                borderRadius: 4, cursor: generating ? "not-allowed" : "pointer",
                letterSpacing: "0.06em", textTransform: "uppercase",
              }}>Cancel</button>
              <button onClick={handleGenerate} disabled={!generatePrompt.trim() || generating} style={{
                padding: "6px 14px", fontSize: 10, fontFamily: F.m, fontWeight: 600,
                background: !generatePrompt.trim() || generating ? C.surfaceAlt : C.accent,
                color: !generatePrompt.trim() || generating ? C.textFaint : "#fff",
                border: "none", borderRadius: 4,
                cursor: !generatePrompt.trim() || generating ? "not-allowed" : "pointer",
                letterSpacing: "0.06em", textTransform: "uppercase",
              }}>{generating ? "Starting…" : "Generate →"}</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes wSlideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────

// Removed: SectionTitle, NavList, NavLink — replaced by action cards

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
    <button type="button" onClick={onClick} style={{
      display: "flex", flexDirection: "column", gap: 10,
      padding: "16px", width: "100%",
      background: C.surface, backgroundImage: gradient,
      border: `1px solid ${C.border}`,
      borderRadius: 10, cursor: "pointer", textAlign: "left",
      transition: "all 0.2s", position: "relative", overflow: "hidden",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.borderHover; e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.transform = "none"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ color: C.accent, opacity: 0.7 }}>{icon}</div>
        <div style={{ fontFamily: F.s, fontSize: 12, fontWeight: 600, color: C.text }}>{title}</div>
      </div>
      <div style={{ fontFamily: F.s, fontSize: 10, color: C.textDim, lineHeight: 1.5 }}>{description}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, height: 2, borderRadius: 1, background: C.surfaceAlt, overflow: "hidden" }}>
          <div style={{ width: `${progress * 100}%`, height: "100%", background: allDone ? "#22c55e" : C.accent, borderRadius: 1, transition: "width 0.3s" }} />
        </div>
        <span style={{ fontFamily: F.m, fontSize: 8, color: C.textDim }}>{doneCount}/{steps}</span>
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
