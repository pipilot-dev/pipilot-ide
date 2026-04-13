/**
 * HelpDialog — editorial-terminal styled help reference.
 * Tabs: Keyboard Shortcuts · About · What's New
 */

import { createPortal } from "react-dom";
import { X, Keyboard, Info, Sparkles } from "lucide-react";
import { useState, useEffect } from "react";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  items: { keys: string[]; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    items: [
      { keys: ["⌘", "P"], description: "Command palette / file search" },
      { keys: ["⌘", "B"], description: "Toggle sidebar" },
      { keys: ["⌘", "⇧", "I"], description: "Toggle AI chat" },
      { keys: ["⌘", "`"], description: "Toggle terminal" },
      { keys: ["⌘", ","], description: "Open settings" },
      { keys: ["⌘", "⇧", "/"], description: "Open this help" },
    ],
  },
  {
    title: "Editing",
    items: [
      { keys: ["⌘", "S"], description: "Save / format" },
      { keys: ["⌘", "Z"], description: "Undo" },
      { keys: ["⌘", "⇧", "Z"], description: "Redo" },
      { keys: ["⌘", "F"], description: "Find" },
      { keys: ["⌘", "H"], description: "Find and replace" },
      { keys: ["Tab"], description: "Accept inline AI suggestion" },
    ],
  },
  {
    title: "Chat & Terminal",
    items: [
      { keys: ["↵"], description: "Send chat message" },
      { keys: ["⌘", "↵"], description: "Submit Generate-with-AI" },
      { keys: ["↑", "↓"], description: "Navigate terminal history" },
      { keys: ["⌘", "L"], description: "Clear terminal" },
      { keys: ["⌘", "C"], description: "Cancel terminal input" },
    ],
  },
];

const RELEASES = [
  {
    version: "v0.1",
    title: "Editorial Terminal redesign",
    items: [
      "Brand-new editorial-terminal design system across all panels",
      "PiPilot Agent is the only chat provider",
      "New Plan mode — research and plan only, no edits",
      "Functional VS Code-style top toolbar with menus & project switcher",
      "Multi-language diagnostics (TypeScript, Python, Go, Rust, PHP, Ruby)",
      "Server-side checkpoints synced to disk for linked projects",
      "Welcome page New File and Generate-with-AI flows",
    ],
  },
];

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const [tab, setTab] = useState<"shortcuts" | "about" | "whats-new">("shortcuts");
  useEffect(() => { injectFonts(); }, []);

  if (!open) return null;

  const tabItems = [
    { id: "shortcuts" as const, label: "Shortcuts", icon: <Keyboard size={11} /> },
    { id: "about" as const, label: "About", icon: <Info size={11} /> },
    { id: "whats-new" as const, label: "What's New", icon: <Sparkles size={11} /> },
  ];

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(6px)",
        fontFamily: FONTS.sans,
      }}
    >
      <div style={{
        width: 640, maxWidth: "92vw", maxHeight: "82vh",
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 10, overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0, 0, 0, 0.7)",
        display: "flex", flexDirection: "column",
        position: "relative",
      }}>
        {/* Glow */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -120, right: -120,
            width: 320, height: 320,
            background: `radial-gradient(circle, ${C.accent}10 0%, transparent 70%)`,
            pointerEvents: "none",
          }}
        />

        {/* ── Header ── */}
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          padding: "22px 28px 16px",
          borderBottom: `1px solid ${C.border}`,
          position: "relative",
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span style={{
                fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
                letterSpacing: "0.18em", textTransform: "uppercase", color: C.accent,
              }}>
                / H
              </span>
              <span style={{
                fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
                letterSpacing: "0.18em", textTransform: "uppercase", color: C.textDim,
              }}>
                Help
              </span>
            </div>
            <h3 style={{
              fontFamily: FONTS.display, fontSize: 28, fontWeight: 400,
              lineHeight: 1, color: C.text, margin: 0,
            }}>
              find your <span style={{ fontStyle: "italic", color: C.accent }}>way</span>
              <span style={{ color: C.accent }}>.</span>
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none",
              color: C.textDim, cursor: "pointer", padding: 6,
              borderRadius: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.color = C.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textDim; }}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Tabs ── */}
        <div style={{
          display: "flex", borderBottom: `1px solid ${C.border}`,
          padding: "0 18px",
          background: C.surfaceAlt,
          flexShrink: 0,
        }}>
          {tabItems.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "12px 16px",
                border: "none", background: "transparent",
                cursor: "pointer",
                fontFamily: FONTS.mono, fontSize: 10, fontWeight: 500,
                letterSpacing: "0.1em", textTransform: "uppercase",
                color: tab === t.id ? C.accent : C.textDim,
                borderBottom: tab === t.id ? `2px solid ${C.accent}` : "2px solid transparent",
                marginBottom: -1,
              }}
              onMouseEnter={(e) => { if (tab !== t.id) e.currentTarget.style.color = C.text; }}
              onMouseLeave={(e) => { if (tab !== t.id) e.currentTarget.style.color = C.textDim; }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "22px 28px" }}>
          {tab === "shortcuts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
              {SHORTCUT_GROUPS.map((group) => (
                <section key={group.title}>
                  <div style={{
                    fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
                    letterSpacing: "0.18em", textTransform: "uppercase",
                    color: C.textDim,
                    marginBottom: 8, paddingBottom: 6,
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    // {group.title}
                  </div>
                  <div>
                    {group.items.map((s, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "9px 0",
                        borderBottom: i < group.items.length - 1 ? `1px solid ${C.border}` : "none",
                      }}>
                        <span style={{
                          fontFamily: FONTS.sans, fontSize: 13, color: C.textMid,
                        }}>
                          {s.description}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          {s.keys.map((k, j) => (
                            <span key={j} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <kbd style={kbdStyle}>{k}</kbd>
                              {j < s.keys.length - 1 && (
                                <span style={{ color: C.textFaint, fontSize: 10 }}>+</span>
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {tab === "about" && (
            <div style={{ color: C.textMid, fontSize: 13, lineHeight: 1.7 }}>
              <div style={{ marginBottom: 22 }}>
                <div style={{
                  fontFamily: FONTS.display, fontSize: 38, fontWeight: 400,
                  lineHeight: 1, color: C.text, marginBottom: 6,
                }}>
                  PiPilot <span style={{ fontStyle: "italic", color: C.accent }}>IDE</span>
                  <span style={{ color: C.accent }}>.</span>
                </div>
                <div style={{
                  fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
                  letterSpacing: "0.18em", textTransform: "uppercase", color: C.textDim,
                }}>
                  // AI-NATIVE WEB IDE · v0.1.0
                </div>
              </div>

              <p style={{ margin: "0 0 24px 0", fontSize: 14, lineHeight: 1.7, maxWidth: 480 }}>
                An editor that thinks with you. Type, ask, generate, refactor,
                deploy — all in one workspace, all on your real disk.
              </p>

              <div style={{
                display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 18, rowGap: 10,
                fontFamily: FONTS.mono, fontSize: 11, color: C.textDim,
                paddingTop: 18,
                borderTop: `1px solid ${C.border}`,
              }}>
                <span>Editor</span>
                <span style={{ color: C.text }}>Multi-tab editor with language support</span>
                <span>Agent</span>
                <span style={{ color: C.text }}>PiPilot Agent</span>
                <span>Storage</span>
                <span style={{ color: C.text }}>Local cache with disk sync for linked projects</span>
                <span>Diagnostics</span>
                <span style={{ color: C.text }}>TypeScript · Python · Go · Rust · PHP · Ruby</span>
                <span>Hosting</span>
                <span style={{ color: C.text }}>Free, unlimited static site hosting</span>
              </div>
            </div>
          )}

          {tab === "whats-new" && (
            <div>
              {RELEASES.map((rel) => (
                <div key={rel.version} style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
                    <span style={{
                      fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
                      letterSpacing: "0.18em", textTransform: "uppercase", color: C.accent,
                    }}>
                      / {rel.version}
                    </span>
                    <span style={{
                      fontFamily: FONTS.display, fontSize: 22, fontWeight: 400,
                      color: C.text, fontStyle: "italic",
                    }}>
                      {rel.title}
                    </span>
                  </div>
                  <ul style={{
                    listStyle: "none", margin: 0, padding: 0,
                  }}>
                    {rel.items.map((item, i) => (
                      <li key={i} style={{
                        display: "flex", alignItems: "flex-start", gap: 12,
                        padding: "8px 0",
                        borderBottom: i < rel.items.length - 1 ? `1px solid ${C.border}` : "none",
                        fontFamily: FONTS.sans, fontSize: 13, color: C.textMid,
                        lineHeight: 1.55,
                      }}>
                        <span style={{
                          fontFamily: FONTS.mono, fontSize: 9,
                          color: C.accent, marginTop: 4,
                          flexShrink: 0,
                        }}>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const kbdStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  minWidth: 22, padding: "3px 7px",
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 3,
  fontFamily: FONTS.mono,
  fontSize: 10, fontWeight: 500,
  color: C.text,
  letterSpacing: 0,
};
