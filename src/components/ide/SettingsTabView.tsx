import { useState, useMemo, useEffect } from "react";
import {
  Type, Palette, Bot, Keyboard, Settings as SettingsIcon, Terminal as TerminalIcon,
  GitBranch, Search, Info, Sparkles, RefreshCw, Check, ArrowUpRight,
} from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

interface CategoryDef {
  id: string;
  index: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  description: string;
}

const CATEGORIES: CategoryDef[] = [
  { id: "editor",      index: "01", label: "Editor",            icon: Type,         description: "Font, indent, layout" },
  { id: "appearance",  index: "02", label: "Appearance",        icon: Palette,      description: "Theme & UI density" },
  { id: "ai",          index: "03", label: "AI Assistant",      icon: Bot,          description: "Inline & chat agent" },
  { id: "terminal",    index: "04", label: "Terminal",          icon: TerminalIcon, description: "Default shell & font" },
  { id: "git",         index: "05", label: "Source Control",    icon: GitBranch,    description: "Author & sync" },
  { id: "search",      index: "06", label: "Search",            icon: Search,       description: "Indexing & exclude" },
  { id: "shortcuts",   index: "07", label: "Keyboard",          icon: Keyboard,     description: "Shortcut reference" },
  { id: "about",       index: "08", label: "About",             icon: Info,         description: "Version & system" },
];

const FONT_FAMILIES = [
  '"Cascadia Code", monospace',
  '"Fira Code", monospace',
  '"JetBrains Mono", monospace',
  '"Source Code Pro", monospace',
  '"Consolas", monospace',
  'monospace',
];

const KEYBOARD_SHORTCUTS = [
  { keys: ["Ctrl", "P"], description: "Quick file open" },
  { keys: ["Ctrl", "Shift", "P"], description: "Command palette" },
  { keys: ["Ctrl", "Shift", "I"], description: "Toggle AI chat" },
  { keys: ["Ctrl", "`"], description: "Toggle terminal" },
  { keys: ["Ctrl", "B"], description: "Toggle sidebar" },
  { keys: ["Ctrl", ","], description: "Open settings" },
  { keys: ["Ctrl", "S"], description: "Save file" },
  { keys: ["Ctrl", "/"], description: "Toggle comment" },
  { keys: ["Ctrl", "F"], description: "Find in file" },
  { keys: ["Ctrl", "Shift", "F"], description: "Find in files" },
  { keys: ["Ctrl", "Click"], description: "Go to definition" },
  { keys: ["Tab"], description: "Accept inline suggestion" },
  { keys: ["Esc"], description: "Dismiss suggestion" },
  { keys: ["Ctrl", "Enter"], description: "Submit modal answer" },
];

// Settings that need to mirror to localStorage so non-React modules
// (TerminalPanel initial state, ActivityBar, etc.) can read them synchronously
const LOCALSTORAGE_KEYS = new Set([
  "terminalDefaultType",
  "showActivityBadges",
  "aiInlineEnabled",
]);

export function SettingsTabView() {
  const { get, set } = useSettings();
  const [activeCategory, setActiveCategory] = useState<string>("editor");
  const [search, setSearch] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [gitAuthor, setGitAuthor] = useState({ name: "", email: "" });
  const [gitSavingHint, setGitSavingHint] = useState<string | null>(null);

  useEffect(() => { injectFonts(); }, []);

  // Load git author config from server
  useEffect(() => {
    fetch("/api/git/config")
      .then(r => r.json())
      .then(data => {
        if (data.name || data.email) {
          setGitAuthor({ name: data.name || "", email: data.email || "" });
        }
      })
      .catch(() => {});
  }, []);

  // Save with visual flash
  const save = async (key: string, value: string) => {
    await set(key, value);
    if (LOCALSTORAGE_KEYS.has(key)) {
      try { localStorage.setItem(`pipilot:${key}`, value); } catch {}
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 900);
  };

  const saveGitConfig = async () => {
    setGitSavingHint("saving...");
    try {
      const res = await fetch("/api/git/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gitAuthor),
      });
      const data = await res.json();
      setGitSavingHint(data.success ? "saved" : "failed");
    } catch {
      setGitSavingHint("failed");
    }
    setTimeout(() => setGitSavingHint(null), 2000);
  };

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return CATEGORIES;
    const q = search.toLowerCase();
    return CATEGORIES.filter((c) =>
      c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
    );
  }, [search]);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        overflow: "hidden",
        background: C.bg,
        color: C.text,
        fontFamily: FONTS.sans,
        position: "relative",
      }}
    >
      {/* Atmospheric radial accent */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -120, right: -160,
          width: 520, height: 520,
          background: `radial-gradient(circle, ${C.accent}0a 0%, transparent 60%)`,
          filter: "blur(20px)",
          pointerEvents: "none",
        }}
      />

      {/* ── Left sidebar — categories ── */}
      <aside
        style={{
          width: 260,
          flexShrink: 0,
          background: C.surface,
          borderRight: `1px solid ${C.border}`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Editorial header */}
        <div style={{ padding: "20px 20px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span aria-hidden style={{
              width: 6, height: 6, borderRadius: "50%",
              background: C.accent,
              boxShadow: `0 0 8px ${C.accent}80`,
            }} />
            <span style={{
              fontFamily: FONTS.mono,
              fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: C.accent,
            }}>/ S</span>
            <span style={{
              fontFamily: FONTS.mono,
              fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: C.text,
            }}>Settings</span>
          </div>

          <h2 style={{
            fontFamily: FONTS.display,
            fontSize: 28,
            fontWeight: 400,
            lineHeight: 1.0,
            letterSpacing: "-0.02em",
            color: C.text,
            margin: "0 0 14px 0",
          }}>
            tune your <span style={{ fontStyle: "italic", color: C.accent }}>workshop</span>
            <span style={{ color: C.accent }}>.</span>
          </h2>

          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 10px",
            background: C.surfaceAlt,
            border: `1px solid ${C.border}`,
            borderRadius: 4,
          }}>
            <Search size={11} style={{ color: C.textDim }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="filter settings..."
              style={{
                flex: 1,
                background: "transparent",
                outline: "none",
                border: "none",
                fontFamily: FONTS.mono,
                fontSize: 11,
                color: C.text,
              }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 16px" }}>
          {filteredCategories.map((cat) => {
            const Icon = cat.icon;
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  width: "100%",
                  padding: "10px 8px",
                  margin: "0 0 2px 0",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  position: "relative",
                  transition: "padding-left 0.18s ease",
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.paddingLeft = "14px";
                    const lbl = e.currentTarget.querySelector("[data-cat-label]") as HTMLElement;
                    if (lbl) lbl.style.color = C.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.paddingLeft = "8px";
                    const lbl = e.currentTarget.querySelector("[data-cat-label]") as HTMLElement;
                    if (lbl) lbl.style.color = C.text;
                  }
                }}
              >
                {/* Active lime indicator bar */}
                {active && (
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: -12, top: "50%", transform: "translateY(-50%)",
                      width: 2, height: 18,
                      background: C.accent,
                      boxShadow: `0 0 8px ${C.accent}80`,
                    }}
                  />
                )}
                <span style={{
                  fontFamily: FONTS.mono,
                  fontSize: 9,
                  color: active ? C.accent : C.textDim,
                  letterSpacing: "0.05em",
                  flexShrink: 0,
                }}>
                  {cat.index}
                </span>
                <Icon size={13} strokeWidth={1.6} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div data-cat-label style={{
                    fontFamily: FONTS.sans,
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    color: active ? C.accent : C.text,
                    transition: "color 0.18s",
                  }}>
                    {cat.label}
                  </div>
                  <div style={{
                    fontFamily: FONTS.mono,
                    fontSize: 9,
                    color: C.textDim,
                    letterSpacing: "0.02em",
                    marginTop: 2,
                  }}>
                    {cat.description}
                  </div>
                </div>
                {active && <ArrowUpRight size={12} strokeWidth={1.5} style={{ color: C.accent }} />}
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Right content — scrollable detail panel ── */}
      <div style={{ flex: 1, overflowY: "auto", position: "relative", zIndex: 1 }}>
        {/* Saved flash badge */}
        {savedFlash && (
          <div
            style={{
              position: "absolute",
              top: 24, right: 32, zIndex: 10,
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 12px",
              background: `${C.accent}1a`,
              color: C.accent,
              border: `1px solid ${C.accent}55`,
              borderRadius: 3,
              fontFamily: FONTS.mono,
              fontSize: 9, fontWeight: 600,
              letterSpacing: "0.1em", textTransform: "uppercase",
              animation: "savedFlash 0.18s ease",
            }}
          >
            <Check size={10} /> saved
          </div>
        )}

        <div style={{ maxWidth: 720, padding: "56px 56px 80px" }}>
          {/* Category header */}
          {(() => {
            const cat = CATEGORIES.find(c => c.id === activeCategory) || CATEGORIES[0];
            return (
              <div style={{ marginBottom: 40 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{
                    fontFamily: FONTS.mono,
                    fontSize: 9, fontWeight: 500,
                    letterSpacing: "0.18em", textTransform: "uppercase",
                    color: C.accent,
                  }}>/ {cat.index}</span>
                  <span style={{
                    fontFamily: FONTS.mono,
                    fontSize: 9, fontWeight: 500,
                    letterSpacing: "0.18em", textTransform: "uppercase",
                    color: C.textDim,
                  }}>{cat.description}</span>
                </div>
                <h1 style={{
                  fontFamily: FONTS.display,
                  fontSize: "clamp(40px, 5vw, 56px)",
                  fontWeight: 400,
                  lineHeight: 0.95,
                  letterSpacing: "-0.025em",
                  margin: 0,
                  color: C.text,
                }}>
                  {cat.label.toLowerCase()}
                  <span style={{ color: C.accent }}>.</span>
                </h1>
              </div>
            );
          })()}

          {/* ─── EDITOR ─── */}
          {activeCategory === "editor" && (
            <>
              <SectionHeading label="Font" />
              <SettingRow label="Font size" hint="Editor font size in pixels">
                <NumberInput value={get("editorFontSize")} onChange={(v) => save("editorFontSize", v)} min={8} max={32} suffix="px" />
              </SettingRow>
              <SettingRow label="Font family" hint="Monospace font for code">
                <SelectInput
                  value={get("editorFontFamily")}
                  onChange={(v) => save("editorFontFamily", v)}
                  options={FONT_FAMILIES.map((f) => ({ value: f, label: f.replace(/['"]/g, "").split(",")[0] }))}
                />
              </SettingRow>
              <SettingRow label="Font ligatures" hint="Combine characters like => and !=">
                <Toggle checked={get("editorFontLigatures") !== "false"} onChange={(v) => save("editorFontLigatures", String(v))} />
              </SettingRow>

              <SectionHeading label="Indentation & Layout" />
              <SettingRow label="Tab size" hint="Number of spaces per indent level">
                <NumberInput value={get("editorTabSize")} onChange={(v) => save("editorTabSize", v)} min={1} max={8} />
              </SettingRow>
              <SettingRow label="Word wrap" hint="Wrap long lines instead of horizontal scroll">
                <SelectInput
                  value={get("editorWordWrap") || "off"}
                  onChange={(v) => save("editorWordWrap", v)}
                  options={[
                    { value: "off", label: "Off" },
                    { value: "on", label: "On" },
                    { value: "wordWrapColumn", label: "At column" },
                  ]}
                />
              </SettingRow>
              <SettingRow label="Show minimap" hint="Display the code minimap on the right">
                <Toggle checked={get("editorMinimap") === "true"} onChange={(v) => save("editorMinimap", String(v))} />
              </SettingRow>
              <SettingRow label="Render whitespace" hint="Show invisible characters">
                <SelectInput
                  value={get("editorRenderWhitespace") || "selection"}
                  onChange={(v) => save("editorRenderWhitespace", v)}
                  options={[
                    { value: "none", label: "None" },
                    { value: "selection", label: "Selection only" },
                    { value: "all", label: "All" },
                  ]}
                />
              </SettingRow>

              <SectionHeading label="Editing Behavior" />
              <SettingRow label="Auto save" hint="Save files automatically as you edit">
                <Toggle checked={get("autoSave") === "true"} onChange={(v) => save("autoSave", String(v))} />
              </SettingRow>
              <SettingRow label="Format on save" hint="Apply formatter when saving">
                <Toggle checked={get("formatOnSave") === "true"} onChange={(v) => save("formatOnSave", String(v))} />
              </SettingRow>
            </>
          )}

          {/* ─── APPEARANCE ─── */}
          {activeCategory === "appearance" && (
            <>
              <SectionHeading label="Theme" />
              <SettingRow label="Color theme" hint="Editorial Terminal — locked. More themes coming soon.">
                <SelectInput
                  value={get("theme") || "editorial-terminal"}
                  onChange={(v) => save("theme", v)}
                  options={[
                    { value: "editorial-terminal", label: "Editorial Terminal (default)" },
                  ]}
                />
              </SettingRow>

              <SectionHeading label="Activity Bar" />
              <SettingRow label="Show badges" hint="Display change counts on activity icons">
                <Toggle checked={get("showActivityBadges") !== "false"} onChange={(v) => save("showActivityBadges", String(v))} />
              </SettingRow>
            </>
          )}

          {/* ─── AI ─── */}
          {activeCategory === "ai" && (
            <>
              <SectionHeading label="Inline Completions" />
              <SettingRow label="Enable inline AI" hint="Show ghost-text completions as you type">
                <Toggle checked={get("aiInlineEnabled") !== "false"} onChange={(v) => save("aiInlineEnabled", String(v))} />
              </SettingRow>
              <SettingRow label="Trigger delay" hint="Milliseconds to wait before requesting a suggestion">
                <NumberInput value={get("aiInlineDelay") || "80"} onChange={(v) => save("aiInlineDelay", v)} min={0} max={2000} step={20} suffix="ms" />
              </SettingRow>
              <SettingRow label="Context window" hint="Lines of code to send before the cursor">
                <NumberInput value={get("aiContextLines") || "30"} onChange={(v) => save("aiContextLines", v)} min={10} max={500} step={10} suffix="lines" />
              </SettingRow>

              <SectionHeading label="Chat Provider" />
              <SettingRow label="Auto-resume on refresh" hint="Continue interrupted streams without prompting">
                <Toggle checked={get("aiAutoResume") === "true"} onChange={(v) => save("aiAutoResume", String(v))} />
              </SettingRow>
            </>
          )}

          {/* ─── TERMINAL ─── */}
          {activeCategory === "terminal" && (
            <>
              <SectionHeading label="Shell" />
              <SettingRow label="Default shell type" hint="Which terminal opens when you click +">
                <SelectInput
                  value={get("terminalDefaultType") || "real"}
                  onChange={(v) => save("terminalDefaultType", v)}
                  options={[
                    { value: "real", label: "System Shell (cmd / bash)" },
                    { value: "virtual", label: "Virtual Shell (file ops)" },
                    { value: "node", label: "Node.js (Nodebox)" },
                  ]}
                />
              </SettingRow>
              <SettingRow label="Font size" hint="Terminal font size in pixels">
                <NumberInput value={get("terminalFontSize") || "12"} onChange={(v) => save("terminalFontSize", v)} min={8} max={24} suffix="px" />
              </SettingRow>
              <SettingRow label="Scrollback lines" hint="Number of lines to keep in terminal history">
                <NumberInput value={get("terminalScrollback") || "10000"} onChange={(v) => save("terminalScrollback", v)} min={1000} max={100000} step={1000} />
              </SettingRow>
              <SettingRow label="Cursor blink" hint="Make terminal cursor blink">
                <Toggle checked={get("terminalCursorBlink") !== "false"} onChange={(v) => save("terminalCursorBlink", String(v))} />
              </SettingRow>
            </>
          )}

          {/* ─── GIT ─── */}
          {activeCategory === "git" && (
            <>
              <SectionHeading label="Author (global git config)" />
              <SettingRow label="Name" hint="Used as the author of all commits">
                <TextInput
                  value={gitAuthor.name}
                  onChange={(v) => setGitAuthor((p) => ({ ...p, name: v }))}
                  placeholder="Your Name"
                />
              </SettingRow>
              <SettingRow label="Email" hint="Used as the author of all commits">
                <TextInput
                  value={gitAuthor.email}
                  onChange={(v) => setGitAuthor((p) => ({ ...p, email: v }))}
                  placeholder="you@example.com"
                />
              </SettingRow>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                {gitSavingHint && (
                  <span style={{
                    fontFamily: FONTS.mono,
                    fontSize: 9,
                    color: gitSavingHint === "failed" ? C.error : C.accent,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    alignSelf: "center",
                  }}>{gitSavingHint}</span>
                )}
                <button
                  onClick={saveGitConfig}
                  style={{
                    padding: "8px 16px",
                    background: C.accent,
                    color: C.bg,
                    border: `1px solid ${C.accent}`,
                    borderRadius: 4,
                    fontFamily: FONTS.mono,
                    fontSize: 10, fontWeight: 700,
                    letterSpacing: "0.12em", textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  Save author
                </button>
              </div>

              <SectionHeading label="Behavior" />
              <SettingRow label="Confirm before sync" hint="Ask before push/pull operations">
                <Toggle checked={get("gitConfirmSync") === "true"} onChange={(v) => save("gitConfirmSync", String(v))} />
              </SettingRow>
            </>
          )}

          {/* ─── SEARCH ─── */}
          {activeCategory === "search" && (
            <>
              <SectionHeading label="Search Behavior" />
              <SettingRow label="Use regex by default" hint="Treat search query as a regular expression">
                <Toggle checked={get("searchRegex") === "true"} onChange={(v) => save("searchRegex", String(v))} />
              </SettingRow>
              <SettingRow label="Case sensitive" hint="Match exact case in searches">
                <Toggle checked={get("searchCaseSensitive") === "true"} onChange={(v) => save("searchCaseSensitive", String(v))} />
              </SettingRow>
              <SettingRow label="Max results" hint="Maximum number of results to display">
                <NumberInput value={get("searchMaxResults") || "200"} onChange={(v) => save("searchMaxResults", v)} min={20} max={2000} step={20} />
              </SettingRow>

              <SectionHeading label="Exclude Patterns" />
              <SettingRow label="Excluded folders" hint="Comma-separated globs to skip during search">
                <TextInput
                  value={get("searchExclude") || "node_modules,.git,dist,build,.next"}
                  onChange={(v) => save("searchExclude", v)}
                  placeholder="node_modules,.git,dist"
                />
              </SettingRow>
            </>
          )}

          {/* ─── SHORTCUTS ─── */}
          {activeCategory === "shortcuts" && (
            <>
              <SectionHeading label="Reference" />
              <div style={{
                marginTop: 8,
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                overflow: "hidden",
              }}>
                {KEYBOARD_SHORTCUTS.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "12px 18px",
                      borderBottom: i < KEYBOARD_SHORTCUTS.length - 1 ? `1px solid ${C.border}` : "none",
                    }}
                  >
                    <span style={{ fontFamily: FONTS.sans, fontSize: 13, color: C.text }}>
                      {s.description}
                    </span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          style={{
                            padding: "2px 8px",
                            fontFamily: FONTS.mono,
                            fontSize: 10,
                            background: C.surfaceAlt,
                            color: C.text,
                            border: `1px solid ${C.border}`,
                            borderRadius: 3,
                            boxShadow: "0 1px 0 #00000040",
                          }}
                        >{k}</kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ─── ABOUT ─── */}
          {activeCategory === "about" && (
            <>
              <div style={{
                padding: 28,
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 6,
                marginBottom: 24,
                position: "relative",
                overflow: "hidden",
              }}>
                <div aria-hidden style={{
                  position: "absolute",
                  top: -80, right: -80,
                  width: 240, height: 240,
                  background: `radial-gradient(circle, ${C.accent}10 0%, transparent 60%)`,
                  filter: "blur(20px)",
                }} />
                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
                    <div style={{
                      width: 56, height: 56,
                      background: C.bg,
                      border: `1px solid ${C.accentLine}`,
                      borderRadius: 12,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: `0 0 24px ${C.accent}20`,
                    }}>
                      <Sparkles size={24} style={{ color: C.accent }} />
                    </div>
                    <div>
                      <div style={{
                        fontFamily: FONTS.display,
                        fontSize: 28,
                        fontWeight: 400,
                        color: C.text,
                        lineHeight: 1,
                      }}>
                        PiPilot<span style={{ color: C.accent }}>.</span>
                      </div>
                      <div style={{
                        fontFamily: FONTS.mono,
                        fontSize: 9, marginTop: 6,
                        color: C.textDim,
                        letterSpacing: "0.1em", textTransform: "uppercase",
                      }}>
                        AI-native web IDE
                      </div>
                    </div>
                  </div>

                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "max-content 1fr",
                    gap: "10px 20px",
                    fontFamily: FONTS.mono, fontSize: 11,
                  }}>
                    <span style={{ color: C.textDim }}>VERSION</span>
                    <span style={{ color: C.text }}>0.1.0-dev</span>
                    <span style={{ color: C.textDim }}>PLATFORM</span>
                    <span style={{ color: C.text }}>{typeof navigator !== "undefined" ? navigator.platform : "—"}</span>
                    <span style={{ color: C.textDim }}>VIEWPORT</span>
                    <span style={{ color: C.text }}>
                      {typeof window !== "undefined" ? `${window.innerWidth} × ${window.innerHeight}` : "—"}
                    </span>
                    <span style={{ color: C.textDim }}>USER AGENT</span>
                    <span style={{ color: C.text, fontSize: 10, wordBreak: "break-all" }}>
                      {typeof navigator !== "undefined" ? navigator.userAgent : "—"}
                    </span>
                  </div>
                </div>
              </div>

              <SectionHeading label="Storage" />
              <SettingRow label="Reset all settings" hint="Restore everything to defaults. This cannot be undone.">
                <button
                  onClick={async () => {
                    if (!confirm("Reset all settings to defaults? This cannot be undone.")) return;
                    const { db } = await import("@/lib/db");
                    await db.settings.clear();
                    try { localStorage.clear(); } catch {}
                    window.location.reload();
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "7px 14px",
                    background: "transparent",
                    color: C.error,
                    border: `1px solid ${C.error}55`,
                    borderRadius: 4,
                    fontFamily: FONTS.mono,
                    fontSize: 10, fontWeight: 600,
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    cursor: "pointer",
                  }}
                >
                  <RefreshCw size={11} />
                  Reset
                </button>
              </SettingRow>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes savedFlash {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function SectionHeading({ label }: { label: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      marginTop: 32, marginBottom: 8,
      paddingBottom: 12,
      borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{
        fontFamily: FONTS.mono,
        fontSize: 9, fontWeight: 500,
        letterSpacing: "0.18em", textTransform: "uppercase",
        color: C.accent,
      }}>//</span>
      <span style={{
        fontFamily: FONTS.mono,
        fontSize: 9, fontWeight: 500,
        letterSpacing: "0.18em", textTransform: "uppercase",
        color: C.text,
      }}>
        {label}
      </span>
    </div>
  );
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-start",
      padding: "16px 0",
      gap: 32,
      borderBottom: `1px solid ${C.border}`,
    }}>
      <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
        <div style={{
          fontFamily: FONTS.sans,
          fontSize: 13,
          fontWeight: 500,
          color: C.text,
          marginBottom: 4,
        }}>
          {label}
        </div>
        {hint && (
          <div style={{
            fontFamily: FONTS.sans,
            fontSize: 11,
            color: C.textMid,
            lineHeight: 1.5,
          }}>
            {hint}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0, minWidth: 200, display: "flex", justifyContent: "flex-end" }}>
        {children}
      </div>
    </div>
  );
}

function NumberInput({ value, onChange, min = 1, max = 200, step = 1, suffix }: {
  value: string; onChange: (v: string) => void;
  min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "6px 12px",
      background: C.surfaceAlt,
      border: `1px solid ${C.border}`,
      borderRadius: 4,
      minWidth: 140,
    }}>
      <input
        type="number"
        value={value}
        min={min} max={max} step={step}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          background: "transparent",
          color: C.text,
          border: "none",
          outline: "none",
          fontFamily: FONTS.mono,
          fontSize: 12,
          width: "100%",
        }}
      />
      {suffix && (
        <span style={{
          fontFamily: FONTS.mono, fontSize: 9,
          color: C.textDim, letterSpacing: "0.05em",
          textTransform: "uppercase", flexShrink: 0,
        }}>{suffix}</span>
      )}
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "7px 12px", fontSize: 12, width: "100%", minWidth: 240,
        background: C.surfaceAlt, color: C.text,
        border: `1px solid ${C.border}`, borderRadius: 4,
        outline: "none",
        fontFamily: FONTS.mono,
      }}
    />
  );
}

function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "7px 12px", fontSize: 12, width: "100%", minWidth: 200,
        background: C.surfaceAlt, color: C.text,
        border: `1px solid ${C.border}`, borderRadius: 4,
        outline: "none", cursor: "pointer",
        fontFamily: FONTS.sans,
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 38, height: 20,
        background: checked ? C.accent : C.surfaceAlt,
        border: `1px solid ${checked ? C.accent : C.border}`,
        borderRadius: 11,
        cursor: "pointer",
        position: "relative",
        transition: "all 0.18s ease",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2, left: checked ? 19 : 2,
          width: 14, height: 14, borderRadius: "50%",
          background: checked ? C.bg : C.textMid,
          transition: "left 0.18s ease, background 0.18s",
        }}
      />
    </button>
  );
}
