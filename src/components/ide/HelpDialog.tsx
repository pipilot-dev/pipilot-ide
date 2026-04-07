import { createPortal } from "react-dom";
import { HelpCircle, X, Keyboard, Info, Sparkles } from "lucide-react";
import { useState } from "react";

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ["Ctrl", "P"], description: "Command Palette (file search)" },
  { keys: ["Ctrl", "Shift", "I"], description: "Toggle AI Chat" },
  { keys: ["Ctrl", "`"], description: "Toggle Terminal" },
  { keys: ["Ctrl", "B"], description: "Toggle Sidebar" },
  { keys: ["Ctrl", ","], description: "Open Settings" },
  { keys: ["Ctrl", "Shift", "/"], description: "Open Help" },
  { keys: ["Enter"], description: "Send chat message" },
  { keys: ["\u2191", "\u2193"], description: "Navigate terminal history" },
  { keys: ["Ctrl", "L"], description: "Clear terminal" },
  { keys: ["Ctrl", "C"], description: "Cancel terminal input" },
];

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  const [tab, setTab] = useState<"shortcuts" | "about" | "whats-new">("shortcuts");

  if (!open) return null;

  const tabItems = [
    { id: "shortcuts" as const, label: "Keyboard Shortcuts", icon: <Keyboard size={14} /> },
    { id: "about" as const, label: "About", icon: <Info size={14} /> },
    { id: "whats-new" as const, label: "What's New", icon: <Sparkles size={14} /> },
  ];

  const kbdStyle: React.CSSProperties = {
    display: "inline-block", padding: "2px 6px",
    background: "hsl(220 13% 25%)", borderRadius: 4,
    fontSize: 11, fontFamily: "monospace", fontWeight: 600,
    color: "hsl(220 14% 80%)", border: "1px solid hsl(220 13% 30%)",
    minWidth: 20, textAlign: "center",
  };

  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)",
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: 560, maxHeight: 480,
        background: "hsl(220 13% 15%)",
        border: "1px solid hsl(220 13% 25%)",
        borderRadius: 10, overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderBottom: "1px solid hsl(220 13% 25%)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <HelpCircle size={16} style={{ color: "hsl(207 90% 60%)" }} />
            <span style={{ fontWeight: 600, fontSize: 14, color: "hsl(220 14% 85%)" }}>Help</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "hsl(220 14% 55%)", cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", borderBottom: "1px solid hsl(220 13% 25%)", padding: "0 12px" }}>
          {tabItems.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", border: "none", cursor: "pointer",
              fontSize: 12, fontWeight: 500,
              color: tab === t.id ? "hsl(207 90% 60%)" : "hsl(220 14% 55%)",
              background: "transparent",
              borderBottom: tab === t.id ? "2px solid hsl(207 90% 60%)" : "2px solid transparent",
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {tab === "shortcuts" && (
            <div>
              {SHORTCUTS.map((s, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 0", borderBottom: "1px solid hsl(220 13% 20%)",
                }}>
                  <span style={{ fontSize: 12, color: "hsl(220 14% 75%)" }}>{s.description}</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {s.keys.map((k, j) => (
                      <span key={j}>
                        <kbd style={kbdStyle}>{k}</kbd>
                        {j < s.keys.length - 1 && <span style={{ margin: "0 2px", color: "hsl(220 14% 40%)" }}>+</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "about" && (
            <div style={{ color: "hsl(220 14% 75%)", fontSize: 13, lineHeight: 1.8 }}>
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: "hsl(207 90% 60%)", marginBottom: 4 }}>PiPilot IDE</div>
                <div style={{ fontSize: 12, color: "hsl(220 14% 50%)" }}>AI-Powered Web IDE</div>
              </div>
              <p>PiPilot is a browser-based IDE for building complete web applications with AI assistance. No local setup required.</p>
              <div style={{ marginTop: 16, fontSize: 12, color: "hsl(220 14% 50%)" }}>
                <div><strong style={{ color: "hsl(220 14% 65%)" }}>Built with:</strong> React, Monaco Editor, Sandpack, Dexie, Tailwind CSS</div>
                <div><strong style={{ color: "hsl(220 14% 65%)" }}>AI:</strong> PiPilot AI via Kilo Gateway</div>
                <div><strong style={{ color: "hsl(220 14% 65%)" }}>Storage:</strong> IndexedDB (100% client-side)</div>
                <div><strong style={{ color: "hsl(220 14% 65%)" }}>Hosting:</strong> Puter.js (free, unlimited)</div>
              </div>
            </div>
          )}

          {tab === "whats-new" && (
            <div style={{ color: "hsl(220 14% 75%)", fontSize: 13 }}>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, color: "hsl(207 90% 60%)", marginBottom: 4 }}>v2.0 — Extension System</div>
                <ul style={{ paddingLeft: 20, lineHeight: 1.8, fontSize: 12, color: "hsl(220 14% 60%)" }}>
                  <li>Real extension marketplace — install, create, and publish extensions</li>
                  <li>Extension API — contribute to sidebar, status bar, commands, chat, terminal</li>
                  <li>Built-in extensions: Word Counter, Bookmarks, Todo Finder, and more</li>
                  <li>Settings panel with editor configuration</li>
                  <li>Notification system with bell icon and history</li>
                  <li>Problems panel with error/warning tracking</li>
                  <li>Help dialog with keyboard shortcuts reference</li>
                  <li>Browser interaction tools for AI (click, scroll, type in preview)</li>
                  <li>Puter.js deployment (free, unlimited hosting)</li>
                </ul>
              </div>
              <div>
                <div style={{ fontWeight: 600, color: "hsl(207 90% 60%)", marginBottom: 4 }}>v1.0 — Initial Release</div>
                <ul style={{ paddingLeft: 20, lineHeight: 1.8, fontSize: 12, color: "hsl(220 14% 60%)" }}>
                  <li>AI-powered code generation with tool calling</li>
                  <li>Monaco editor with multi-tab support</li>
                  <li>Live web preview via Sandpack</li>
                  <li>Virtual terminal with 25+ commands</li>
                  <li>Git integration with isomorphic-git</li>
                  <li>Project management with checkpoints/undo</li>
                  <li>Screenshot + DOM analysis for AI visual verification</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
