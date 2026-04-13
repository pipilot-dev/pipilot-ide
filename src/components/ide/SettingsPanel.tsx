import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Type, Palette, Keyboard, X, Check, Info } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES = [
  { id: "editor",     label: "Editor",      icon: Type,     hint: "Font, indent, layout" },
  { id: "appearance", label: "Appearance",   icon: Palette,  hint: "Badges & density" },
  { id: "shortcuts",  label: "Shortcuts",    icon: Keyboard, hint: "Key reference" },
  { id: "about",      label: "About",        icon: Info,     hint: "Version info" },
] as const;

type CategoryId = (typeof CATEGORIES)[number]["id"];

const SHORTCUTS = [
  { keys: ["Ctrl", "P"], desc: "Command Palette" },
  { keys: ["Ctrl", "Shift", "I"], desc: "Toggle AI Chat" },
  { keys: ["Ctrl", "`"], desc: "Toggle Terminal" },
  { keys: ["Ctrl", "B"], desc: "Toggle Sidebar" },
  { keys: ["Ctrl", ","], desc: "Settings" },
  { keys: ["Ctrl", "S"], desc: "Save (auto-saved)" },
  { keys: ["Ctrl", "W"], desc: "Close Tab" },
  { keys: ["Ctrl", "N"], desc: "New File" },
  { keys: ["Ctrl", "Shift", "/"], desc: "Help" },
  { keys: ["Ctrl", "A"], desc: "Select All (in file tree)" },
  { keys: ["Esc"], desc: "Clear selection / Close panel" },
  { keys: ["Tab"], desc: "Accept AI suggestion" },
];

const FONT_OPTIONS = [
  { value: '"Cascadia Code", "Fira Code", monospace', label: "Cascadia Code" },
  { value: '"JetBrains Mono", monospace', label: "JetBrains Mono" },
  { value: '"Fira Code", monospace', label: "Fira Code" },
  { value: '"Source Code Pro", monospace', label: "Source Code Pro" },
  { value: '"Consolas", monospace', label: "Consolas" },
  { value: "monospace", label: "System Mono" },
];

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [active, setActive] = useState<CategoryId>("editor");
  const { get, set: rawSet } = useSettings();
  const [flash, setFlash] = useState(false);

  useEffect(() => { injectFonts(); }, []);

  const save = async (key: string, value: string) => {
    await rawSet(key, value);
    try { localStorage.setItem(`pipilot:${key}`, value); } catch {}
    window.dispatchEvent(new CustomEvent("pipilot:setting-changed", { detail: { key, value } }));
    setFlash(true);
    setTimeout(() => setFlash(false), 800);
  };

  if (!open) return null;

  const modal = (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 760, maxWidth: "90vw",
        height: 540, maxHeight: "85vh",
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        display: "flex",
        overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
      }}>
        {/* ── Sidebar ── */}
        <aside style={{
          width: 220, flexShrink: 0,
          background: C.surface,
          borderRight: `1px solid ${C.border}`,
          display: "flex", flexDirection: "column",
          padding: "16px 0",
        }}>
          {/* Header */}
          <div style={{
            padding: "0 16px 14px",
            display: "flex", alignItems: "center", gap: 8,
            borderBottom: `1px solid ${C.border}`,
            marginBottom: 8,
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: "50%",
              background: C.accent,
              boxShadow: `0 0 6px ${C.accent}80`,
            }} />
            <span style={{
              fontFamily: FONTS.mono, fontSize: 9, fontWeight: 600,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: C.text,
            }}>
              Settings
            </span>
          </div>

          {/* Category buttons */}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isActive = active === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActive(cat.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    width: "100%", padding: "8px 10px", margin: "1px 0",
                    background: isActive ? C.surfaceAlt : "transparent",
                    border: "none", borderRadius: 3,
                    borderLeft: isActive ? `2px solid ${C.accent}` : "2px solid transparent",
                    cursor: "pointer", textAlign: "left",
                    transition: "all 0.12s",
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = C.surfaceAlt; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                >
                  <Icon size={13} style={{ color: isActive ? C.accent : C.textDim, flexShrink: 0 }} />
                  <div>
                    <div style={{
                      fontFamily: FONTS.sans, fontSize: 12,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? C.text : C.textMid,
                    }}>
                      {cat.label}
                    </div>
                    <div style={{
                      fontFamily: FONTS.mono, fontSize: 8,
                      color: C.textDim, letterSpacing: "0.05em",
                      marginTop: 1,
                    }}>
                      {cat.hint}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── Content ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Header bar */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 20px", borderBottom: `1px solid ${C.border}`,
            flexShrink: 0,
          }}>
            <span style={{
              fontFamily: FONTS.mono, fontSize: 10, fontWeight: 600,
              letterSpacing: "0.12em", textTransform: "uppercase",
              color: C.text,
            }}>
              {CATEGORIES.find((c) => c.id === active)?.label}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {flash && (
                <span style={{
                  fontFamily: FONTS.mono, fontSize: 8, fontWeight: 700,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  color: C.accent, display: "flex", alignItems: "center", gap: 4,
                }}>
                  <Check size={10} /> saved
                </span>
              )}
              <button
                onClick={onClose}
                style={{
                  background: "transparent", border: "none",
                  color: C.textDim, cursor: "pointer", padding: 4,
                  borderRadius: 3, display: "flex",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = C.text; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = C.textDim; }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Scrollable content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px 40px" }}>
            {active === "editor" && <EditorSection get={get} save={save} />}
            {active === "appearance" && <AppearanceSection get={get} save={save} />}
            {active === "shortcuts" && <ShortcutsSection />}
            {active === "about" && <AboutSection />}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

/* ═══════════════════════════════════════════════════════════════════════
   Shared UI primitives
   ═══════════════════════════════════════════════════════════════════════ */

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "12px 0", gap: 24, borderBottom: `1px solid ${C.border}`,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: FONTS.sans, fontSize: 12, fontWeight: 500, color: C.text }}>{label}</div>
        {hint && <div style={{ fontFamily: FONTS.sans, fontSize: 10, color: C.textDim, marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Heading({ text }: { text: string }) {
  return (
    <div style={{
      fontFamily: FONTS.mono, fontSize: 8, fontWeight: 700,
      letterSpacing: "0.18em", textTransform: "uppercase",
      color: C.accent, margin: "20px 0 8px",
    }}>
      / {text}
    </div>
  );
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onToggle(!on)}
      type="button"
      style={{
        width: 36, height: 18,
        background: on ? C.accent : C.surfaceAlt,
        border: `1px solid ${on ? C.accent : C.border}`,
        borderRadius: 9, cursor: "pointer",
        position: "relative", transition: "all 0.15s", flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 2,
        left: on ? 19 : 2,
        width: 12, height: 12, borderRadius: "50%",
        background: on ? C.bg : C.textMid,
        transition: "left 0.15s",
      }} />
    </button>
  );
}

function NumberField({ value, onChange, min = 1, max = 100, step = 1, suffix }: {
  value: string; onChange: (v: string) => void;
  min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      background: C.surfaceAlt, border: `1px solid ${C.border}`,
      borderRadius: 3, padding: "4px 8px",
    }}>
      <input
        type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 50, background: "transparent", border: "none", outline: "none",
          fontFamily: FONTS.mono, fontSize: 11, color: C.text, textAlign: "center",
        }}
      />
      {suffix && <span style={{ fontFamily: FONTS.mono, fontSize: 8, color: C.textDim }}>{suffix}</span>}
    </div>
  );
}

function SelectField({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "5px 10px", fontSize: 11, minWidth: 180,
        background: C.surfaceAlt, color: C.text,
        border: `1px solid ${C.border}`, borderRadius: 3,
        outline: "none", cursor: "pointer", fontFamily: FONTS.sans,
      }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Sections
   ═══════════════════════════════════════════════════════════════════════ */

type SectionProps = { get: (k: string) => string; save: (k: string, v: string) => void };

function EditorSection({ get, save }: SectionProps) {
  return (
    <>
      <Heading text="Font" />
      <Row label="Font size" hint="Editor text size in pixels">
        <NumberField value={get("editorFontSize") || "14"} onChange={(v) => save("editorFontSize", v)} min={8} max={32} suffix="px" />
      </Row>
      <Row label="Font family" hint="Monospace font for code editing">
        <SelectField value={get("editorFontFamily") || '"JetBrains Mono", monospace'} onChange={(v) => save("editorFontFamily", v)} options={FONT_OPTIONS} />
      </Row>
      <Row label="Ligatures" hint="Render => as ⇒ and != as ≠">
        <Toggle on={get("editorFontLigatures") !== "false"} onToggle={(v) => save("editorFontLigatures", String(v))} />
      </Row>

      <Heading text="Indentation" />
      <Row label="Tab size" hint="Spaces per indent level">
        <NumberField value={get("editorTabSize") || "2"} onChange={(v) => save("editorTabSize", v)} min={1} max={8} />
      </Row>
      <Row label="Word wrap" hint="Wrap long lines at viewport edge">
        <Toggle on={(get("editorWordWrap") || "off") === "on"} onToggle={(v) => save("editorWordWrap", v ? "on" : "off")} />
      </Row>

      <Heading text="Display" />
      <Row label="Minimap" hint="Code overview on the right edge">
        <Toggle on={get("editorMinimap") === "true"} onToggle={(v) => save("editorMinimap", String(v))} />
      </Row>
      <Row label="Whitespace" hint="Show invisible characters">
        <SelectField
          value={get("editorRenderWhitespace") || "selection"}
          onChange={(v) => save("editorRenderWhitespace", v)}
          options={[
            { value: "none", label: "None" },
            { value: "selection", label: "In selection" },
            { value: "all", label: "All" },
          ]}
        />
      </Row>
      <Row label="Format on save" hint="Auto-format when saving">
        <Toggle on={get("formatOnSave") === "true"} onToggle={(v) => save("formatOnSave", String(v))} />
      </Row>
    </>
  );
}

function AppearanceSection({ get, save }: SectionProps) {
  return (
    <>
      <Heading text="Activity Bar" />
      <Row label="Show badges" hint="Display change counts on sidebar icons">
        <Toggle on={get("showActivityBadges") !== "false"} onToggle={(v) => save("showActivityBadges", String(v))} />
      </Row>

      <Heading text="Theme" />
      <Row label="Color theme" hint="Editorial Terminal is the only theme">
        <SelectField
          value="editorial-terminal"
          onChange={() => {}}
          options={[{ value: "editorial-terminal", label: "Editorial Terminal" }]}
        />
      </Row>
      <div style={{
        marginTop: 12, padding: 12,
        background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 3,
        fontFamily: FONTS.sans, fontSize: 10, color: C.textDim, lineHeight: 1.6,
      }}>
        Additional themes will be available in a future release.
      </div>
    </>
  );
}


function ShortcutsSection() {
  return (
    <>
      <Heading text="Reference" />
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 3, overflow: "hidden",
      }}>
        {SHORTCUTS.map((s, i) => (
          <div
            key={i}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 14px",
              borderBottom: i < SHORTCUTS.length - 1 ? `1px solid ${C.border}` : "none",
            }}
          >
            <span style={{ fontFamily: FONTS.sans, fontSize: 12, color: C.text }}>{s.desc}</span>
            <div style={{ display: "flex", gap: 3 }}>
              {s.keys.map((k, j) => (
                <kbd key={j} style={{
                  padding: "2px 7px", fontFamily: FONTS.mono, fontSize: 9,
                  background: C.surfaceAlt, color: C.text,
                  border: `1px solid ${C.border}`, borderRadius: 2,
                  boxShadow: "0 1px 0 #00000040",
                }}>
                  {k}
                </kbd>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function AboutSection() {
  return (
    <>
      <Heading text="PiPilot IDE" />
      <div style={{
        padding: 16, background: C.surface,
        border: `1px solid ${C.border}`, borderRadius: 3,
      }}>
        <div style={{
          fontFamily: FONTS.display, fontSize: 24, color: C.text, marginBottom: 8,
        }}>
          Pi<span style={{ color: C.accent }}>Pilot</span>
        </div>
        <div style={{
          fontFamily: FONTS.mono, fontSize: 9, color: C.textDim,
          letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 16,
        }}>
          v0.1 — Editorial Terminal
        </div>
        <div style={{
          display: "grid", gridTemplateColumns: "auto 1fr",
          columnGap: 16, rowGap: 8,
          fontFamily: FONTS.mono, fontSize: 10, color: C.textDim,
        }}>
          <span>Editor</span><span style={{ color: C.text }}>Multi-tab editor with language support</span>
          <span>Agent</span><span style={{ color: C.text }}>PiPilot Agent</span>
          <span>Storage</span><span style={{ color: C.text }}>Local cache with disk sync</span>
          <span>Diagnostics</span><span style={{ color: C.text }}>TypeScript · Python · Go · Rust · PHP · Ruby</span>
          <span>Hosting</span><span style={{ color: C.text }}>Free, unlimited static hosting</span>
        </div>
      </div>
    </>
  );
}
