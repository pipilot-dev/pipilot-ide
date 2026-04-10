import { useState, useMemo } from "react";
import {
  Type, Palette, Bot, Keyboard, Settings as SettingsIcon, Terminal as TerminalIcon,
  GitBranch, Search, Save, Info, Sparkles, RefreshCw, Check,
} from "lucide-react";
import { useSettings } from "@/hooks/useSettings";

const COLORS = {
  bg: "hsl(220 13% 14%)",
  sidebar: "hsl(220 13% 12%)",
  text: "hsl(220 14% 88%)",
  textMuted: "hsl(220 14% 55%)",
  textDim: "hsl(220 14% 40%)",
  border: "hsl(220 13% 22%)",
  accent: "hsl(207 90% 60%)",
  active: "hsl(220 13% 22%)",
  inputBg: "hsl(220 13% 10%)",
};

interface CategoryDef {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  description?: string;
}

const CATEGORIES: CategoryDef[] = [
  { id: "editor", label: "Editor", icon: Type, description: "Font, indentation, layout" },
  { id: "appearance", label: "Appearance", icon: Palette, description: "Theme & UI" },
  { id: "ai", label: "AI Assistant", icon: Bot, description: "Model & inline completions" },
  { id: "terminal", label: "Terminal", icon: TerminalIcon, description: "Default shell & history" },
  { id: "git", label: "Source Control", icon: GitBranch, description: "Author & sync" },
  { id: "search", label: "Search", icon: Search, description: "Indexing & exclude patterns" },
  { id: "shortcuts", label: "Keyboard Shortcuts", icon: Keyboard, description: "Key bindings" },
  { id: "about", label: "About", icon: Info, description: "Version & system info" },
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
  { keys: ["Ctrl", "P"], description: "Command Palette" },
  { keys: ["Ctrl", "Shift", "I"], description: "Toggle AI Chat" },
  { keys: ["Ctrl", "`"], description: "Toggle Terminal" },
  { keys: ["Ctrl", "B"], description: "Toggle Sidebar" },
  { keys: ["Ctrl", ","], description: "Open Settings" },
  { keys: ["Ctrl", "Shift", "P"], description: "Command Palette (alt)" },
  { keys: ["Ctrl", "S"], description: "Save File" },
  { keys: ["Ctrl", "/"], description: "Toggle Comment" },
  { keys: ["Ctrl", "F"], description: "Find in File" },
  { keys: ["Ctrl", "Shift", "F"], description: "Find in Files" },
  { keys: ["Ctrl", "Click"], description: "Go to Definition" },
  { keys: ["Tab"], description: "Accept Inline Suggestion" },
  { keys: ["Esc"], description: "Dismiss Inline Suggestion" },
];

// ── Reusable settings widgets ────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{
        fontSize: 13, fontWeight: 600, color: COLORS.text,
        marginBottom: 16, paddingBottom: 8,
        borderBottom: `1px solid ${COLORS.border}`,
      }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      padding: "12px 0", gap: 24,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: COLORS.text, marginBottom: 2 }}>{label}</div>
        {description && (
          <div style={{ fontSize: 11, color: COLORS.textMuted, lineHeight: 1.5 }}>{description}</div>
        )}
      </div>
      <div style={{ flexShrink: 0, minWidth: 200 }}>{children}</div>
    </div>
  );
}

function NumberInput({ value, onChange, min = 1, max = 200, step = 1, suffix }: {
  value: string; onChange: (v: string) => void;
  min?: number; max?: number; step?: number; suffix?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        type="number"
        value={value}
        min={min} max={max} step={step}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "6px 10px", fontSize: 12, width: 100,
          background: COLORS.inputBg, color: COLORS.text,
          border: `1px solid ${COLORS.border}`, borderRadius: 4,
          outline: "none",
        }}
      />
      {suffix && <span style={{ fontSize: 11, color: COLORS.textMuted }}>{suffix}</span>}
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
        padding: "6px 10px", fontSize: 12, width: "100%",
        background: COLORS.inputBg, color: COLORS.text,
        border: `1px solid ${COLORS.border}`, borderRadius: 4,
        outline: "none",
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
        padding: "6px 10px", fontSize: 12, width: "100%",
        background: COLORS.inputBg, color: COLORS.text,
        border: `1px solid ${COLORS.border}`, borderRadius: 4,
        outline: "none", cursor: "pointer",
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
        width: 36, height: 20, borderRadius: 12,
        background: checked ? COLORS.accent : "hsl(220 13% 25%)",
        border: "none", cursor: "pointer",
        position: "relative",
        transition: "background 0.15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: "50%",
          background: "#fff",
          transition: "left 0.15s",
        }}
      />
    </button>
  );
}

// ── Main settings tab view ───────────────────────────────────────
export function SettingsTabView() {
  const { get, set } = useSettings();
  const [activeCategory, setActiveCategory] = useState<string>("editor");
  const [search, setSearch] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  // Helper to save with visual feedback
  const save = async (key: string, value: string) => {
    await set(key, value);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 800);
  };

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return CATEGORIES;
    const q = search.toLowerCase();
    return CATEGORIES.filter((c) =>
      c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)
    );
  }, [search]);

  return (
    <div style={{
      flex: 1, display: "flex", overflow: "hidden",
      background: COLORS.bg, color: COLORS.text,
    }}>
      {/* Left sidebar with categories */}
      <div style={{
        width: 240, flexShrink: 0,
        background: COLORS.sidebar,
        borderRight: `1px solid ${COLORS.border}`,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        <div style={{ padding: "16px 16px 12px" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 14, fontWeight: 700, marginBottom: 12,
          }}>
            <SettingsIcon size={16} style={{ color: COLORS.accent }} />
            Settings
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search settings..."
            style={{
              width: "100%", padding: "6px 10px", fontSize: 11,
              background: COLORS.inputBg, color: COLORS.text,
              border: `1px solid ${COLORS.border}`, borderRadius: 4,
              outline: "none",
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 16px" }}>
          {filteredCategories.map((cat) => {
            const Icon = cat.icon;
            const active = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  width: "100%", padding: "8px 10px", marginBottom: 2,
                  fontSize: 12, textAlign: "left",
                  background: active ? COLORS.active : "transparent",
                  color: active ? COLORS.text : COLORS.textMuted,
                  border: "none", borderRadius: 5, cursor: "pointer",
                  borderLeft: `2px solid ${active ? COLORS.accent : "transparent"}`,
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = "hsl(220 13% 18%)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                <Icon size={13} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: active ? 600 : 400 }}>{cat.label}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right content */}
      <div style={{ flex: 1, overflowY: "auto", position: "relative" }}>
        {savedFlash && (
          <div style={{
            position: "absolute", top: 16, right: 24, zIndex: 10,
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 10px", borderRadius: 4,
            background: "hsl(142 71% 45% / 0.15)", color: "hsl(142 71% 70%)",
            border: "1px solid hsl(142 71% 45% / 0.3)",
            fontSize: 11, fontWeight: 600,
          }}>
            <Check size={11} /> Saved
          </div>
        )}

        <div style={{ maxWidth: 720, padding: "32px 40px" }}>
          {activeCategory === "editor" && (
            <>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Editor</h2>
              <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 24 }}>
                Configure how code looks and behaves in the editor.
              </p>

              <Section title="Font">
                <Row label="Font size" description="Editor font size in pixels">
                  <NumberInput
                    value={get("editorFontSize")}
                    onChange={(v) => save("editorFontSize", v)}
                    min={8} max={32} suffix="px"
                  />
                </Row>
                <Row label="Font family" description="Monospace font for code">
                  <SelectInput
                    value={get("editorFontFamily")}
                    onChange={(v) => save("editorFontFamily", v)}
                    options={FONT_FAMILIES.map((f) => ({ value: f, label: f.replace(/['"]/g, "").split(",")[0] }))}
                  />
                </Row>
                <Row label="Font ligatures" description="Combine characters like => and !=">
                  <Toggle
                    checked={get("editorFontLigatures") !== "false"}
                    onChange={(v) => save("editorFontLigatures", String(v))}
                  />
                </Row>
              </Section>

              <Section title="Indentation & Layout">
                <Row label="Tab size" description="Number of spaces per indent level">
                  <NumberInput
                    value={get("editorTabSize")}
                    onChange={(v) => save("editorTabSize", v)}
                    min={1} max={8}
                  />
                </Row>
                <Row label="Word wrap" description="Wrap long lines instead of horizontal scroll">
                  <SelectInput
                    value={get("editorWordWrap")}
                    onChange={(v) => save("editorWordWrap", v)}
                    options={[
                      { value: "off", label: "Off" },
                      { value: "on", label: "On" },
                      { value: "wordWrapColumn", label: "At column" },
                    ]}
                  />
                </Row>
                <Row label="Show minimap" description="Display the code minimap on the right">
                  <Toggle
                    checked={get("editorMinimap") === "true"}
                    onChange={(v) => save("editorMinimap", String(v))}
                  />
                </Row>
                <Row label="Render whitespace" description="Show invisible characters">
                  <SelectInput
                    value={get("editorRenderWhitespace") || "selection"}
                    onChange={(v) => save("editorRenderWhitespace", v)}
                    options={[
                      { value: "none", label: "None" },
                      { value: "selection", label: "Selection only" },
                      { value: "all", label: "All" },
                    ]}
                  />
                </Row>
              </Section>

              <Section title="Editing Behavior">
                <Row label="Auto save" description="Save files automatically as you edit">
                  <Toggle
                    checked={get("autoSave") === "true"}
                    onChange={(v) => save("autoSave", String(v))}
                  />
                </Row>
                <Row label="Format on save" description="Apply formatter when saving">
                  <Toggle
                    checked={get("formatOnSave") === "true"}
                    onChange={(v) => save("formatOnSave", String(v))}
                  />
                </Row>
              </Section>
            </>
          )}

          {activeCategory === "appearance" && (
            <>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Appearance</h2>
              <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 24 }}>
                Theme and visual preferences.
              </p>

              <Section title="Theme">
                <Row label="Color theme" description="Editor and UI color scheme">
                  <SelectInput
                    value={get("theme") || "dark"}
                    onChange={(v) => save("theme", v)}
                    options={[
                      { value: "dark", label: "Dark (Default)" },
                      { value: "light", label: "Light" },
                      { value: "high-contrast", label: "High Contrast" },
                    ]}
                  />
                </Row>
                <Row label="UI density" description="Spacing and padding throughout the IDE">
                  <SelectInput
                    value={get("uiDensity") || "comfortable"}
                    onChange={(v) => save("uiDensity", v)}
                    options={[
                      { value: "compact", label: "Compact" },
                      { value: "comfortable", label: "Comfortable" },
                      { value: "spacious", label: "Spacious" },
                    ]}
                  />
                </Row>
              </Section>

              <Section title="Activity Bar">
                <Row label="Show badges" description="Display change counts on activity icons">
                  <Toggle
                    checked={get("showActivityBadges") !== "false"}
                    onChange={(v) => save("showActivityBadges", String(v))}
                  />
                </Row>
              </Section>
            </>
          )}

          {activeCategory === "ai" && (
            <>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>AI Assistant</h2>
              <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 24 }}>
                Configure inline AI completions and chat behavior.
              </p>

              <Section title="Inline Completions">
                <Row label="Enable inline AI" description="Show ghost-text completions as you type">
                  <Toggle
                    checked={get("aiInlineEnabled") !== "false"}
                    onChange={(v) => save("aiInlineEnabled", String(v))}
                  />
                </Row>
                <Row label="Trigger delay" description="Milliseconds to wait before requesting a suggestion">
                  <NumberInput
                    value={get("aiInlineDelay") || "300"}
                    onChange={(v) => save("aiInlineDelay", v)}
                    min={0} max={2000} step={50} suffix="ms"
                  />
                </Row>
                <Row label="Context window" description="Lines of code to send before/after cursor">
                  <NumberInput
                    value={get("aiContextLines") || "80"}
                    onChange={(v) => save("aiContextLines", v)}
                    min={20} max={500} step={10} suffix="lines"
                  />
                </Row>
              </Section>

              <Section title="Chat Provider">
                <Row label="Default provider" description="AI provider for chat sessions">
                  <SelectInput
                    value={get("aiProvider") || "claude-agent"}
                    onChange={(v) => save("aiProvider", v)}
                    options={[
                      { value: "claude-agent", label: "Claude Agent (server-side)" },
                      { value: "ai-sdk", label: "AI SDK (browser)" },
                    ]}
                  />
                </Row>
                <Row label="Auto-resume on refresh" description="Continue interrupted streams automatically">
                  <Toggle
                    checked={get("aiAutoResume") === "true"}
                    onChange={(v) => save("aiAutoResume", String(v))}
                  />
                </Row>
              </Section>
            </>
          )}

          {activeCategory === "terminal" && (
            <>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Terminal</h2>
              <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 24 }}>
                Default shell and terminal behavior.
              </p>

              <Section title="Shell">
                <Row label="Default shell type" description="Which terminal opens when you click +">
                  <SelectInput
                    value={get("terminalDefaultType") || "real"}
                    onChange={(v) => save("terminalDefaultType", v)}
                    options={[
                      { value: "real", label: "System Shell (cmd/bash)" },
                      { value: "virtual", label: "Virtual Shell (file ops)" },
                      { value: "node", label: "Node.js (Nodebox)" },
                    ]}
                  />
                </Row>
                <Row label="Font size" description="Terminal font size in pixels">
                  <NumberInput
                    value={get("terminalFontSize") || "12"}
                    onChange={(v) => save("terminalFontSize", v)}
                    min={8} max={24} suffix="px"
                  />
                </Row>
                <Row label="Scrollback lines" description="Number of lines to keep in terminal history">
                  <NumberInput
                    value={get("terminalScrollback") || "10000"}
                    onChange={(v) => save("terminalScrollback", v)}
                    min={1000} max={100000} step={1000}
                  />
                </Row>
                <Row label="Cursor blink" description="Make terminal cursor blink">
                  <Toggle
                    checked={get("terminalCursorBlink") !== "false"}
                    onChange={(v) => save("terminalCursorBlink", String(v))}
                  />
                </Row>
              </Section>
            </>
          )}

          {activeCategory === "git" && (
            <>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Source Control</h2>
              <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 24 }}>
                Git integration preferences.
              </p>

              <Section title="Author">
                <Row label="Name" description="Author name for commits">
                  <TextInput
                    value={get("gitAuthorName") || ""}
                    onChange={(v) => save("gitAuthorName", v)}
                    placeholder="Your Name"
                  />
                </Row>
                <Row label="Email" description="Author email for commits">
                  <TextInput
                    value={get("gitAuthorEmail") || ""}
                    onChange={(v) => save("gitAuthorEmail", v)}
                    placeholder="you@example.com"
                  />
                </Row>
              </Section>

              <Section title="Behavior">
                <Row label="Auto-fetch interval" description="Minutes between automatic git fetch (0 = disabled)">
                  <NumberInput
                    value={get("gitAutoFetch") || "0"}
                    onChange={(v) => save("gitAutoFetch", v)}
                    min={0} max={60} suffix="min"
                  />
                </Row>
                <Row label="Confirm sync" description="Ask before push/pull operations">
                  <Toggle
                    checked={get("gitConfirmSync") === "true"}
                    onChange={(v) => save("gitConfirmSync", String(v))}
                  />
                </Row>
                <Row label="Show staged section" description="Display staged changes section by default">
                  <Toggle
                    checked={get("gitShowStaged") !== "false"}
                    onChange={(v) => save("gitShowStaged", String(v))}
                  />
                </Row>
              </Section>
            </>
          )}

          {activeCategory === "search" && (
            <>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Search</h2>
              <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 24 }}>
                File search and indexing settings.
              </p>

              <Section title="Search Behavior">
                <Row label="Use regex by default" description="Treat search query as regex">
                  <Toggle
                    checked={get("searchRegex") === "true"}
                    onChange={(v) => save("searchRegex", String(v))}
                  />
                </Row>
                <Row label="Case sensitive" description="Match exact case in searches">
                  <Toggle
                    checked={get("searchCaseSensitive") === "true"}
                    onChange={(v) => save("searchCaseSensitive", String(v))}
                  />
                </Row>
                <Row label="Max results" description="Maximum number of results to display">
                  <NumberInput
                    value={get("searchMaxResults") || "200"}
                    onChange={(v) => save("searchMaxResults", v)}
                    min={20} max={2000} step={20}
                  />
                </Row>
              </Section>

              <Section title="Exclude Patterns">
                <Row label="Excluded folders" description="Comma-separated globs to skip">
                  <TextInput
                    value={get("searchExclude") || "node_modules,.git,dist,build,.next"}
                    onChange={(v) => save("searchExclude", v)}
                    placeholder="node_modules,.git,dist"
                  />
                </Row>
              </Section>
            </>
          )}

          {activeCategory === "shortcuts" && (
            <>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Keyboard Shortcuts</h2>
              <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 24 }}>
                Reference for available keyboard shortcuts.
              </p>

              <div style={{
                background: COLORS.inputBg, border: `1px solid ${COLORS.border}`, borderRadius: 6,
                overflow: "hidden",
              }}>
                {KEYBOARD_SHORTCUTS.map((s, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "10px 16px",
                      borderBottom: i < KEYBOARD_SHORTCUTS.length - 1 ? `1px solid ${COLORS.border}` : "none",
                    }}
                  >
                    <span style={{ fontSize: 12, color: COLORS.text }}>{s.description}</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          style={{
                            padding: "2px 8px", fontSize: 10, fontFamily: "monospace",
                            background: "hsl(220 13% 18%)", color: COLORS.text,
                            border: `1px solid ${COLORS.border}`, borderRadius: 3,
                            boxShadow: "0 1px 0 hsl(220 13% 8%)",
                          }}
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeCategory === "about" && (
            <>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>About PiPilot</h2>
              <p style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 24 }}>
                Version and system information.
              </p>

              <div style={{
                padding: 24, borderRadius: 8,
                background: "linear-gradient(135deg, hsl(207 90% 50% / 0.08), hsl(280 75% 50% / 0.08))",
                border: `1px solid ${COLORS.border}`,
                marginBottom: 24,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <Sparkles size={28} style={{ color: COLORS.accent }} />
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>PiPilot IDE</div>
                    <div style={{ fontSize: 11, color: COLORS.textMuted }}>AI-powered web IDE</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", fontSize: 11 }}>
                  <span style={{ color: COLORS.textMuted }}>Version</span>
                  <span style={{ color: COLORS.text, fontFamily: "monospace" }}>0.1.0-dev</span>
                  <span style={{ color: COLORS.textMuted }}>Platform</span>
                  <span style={{ color: COLORS.text, fontFamily: "monospace" }}>{typeof navigator !== "undefined" ? navigator.platform : "—"}</span>
                  <span style={{ color: COLORS.textMuted }}>User Agent</span>
                  <span style={{ color: COLORS.text, fontFamily: "monospace", fontSize: 10, wordBreak: "break-all" }}>
                    {typeof navigator !== "undefined" ? navigator.userAgent : "—"}
                  </span>
                  <span style={{ color: COLORS.textMuted }}>Viewport</span>
                  <span style={{ color: COLORS.text, fontFamily: "monospace" }}>
                    {typeof window !== "undefined" ? `${window.innerWidth} × ${window.innerHeight}` : "—"}
                  </span>
                </div>
              </div>

              <Section title="Storage">
                <Row label="Reset all settings" description="Restore all settings to their default values">
                  <button
                    onClick={async () => {
                      if (!confirm("Reset all settings to defaults? This cannot be undone.")) return;
                      const { db } = await import("@/lib/db");
                      await db.settings.clear();
                      window.location.reload();
                    }}
                    style={{
                      padding: "6px 12px", fontSize: 11, fontWeight: 600,
                      background: "hsl(0 84% 50% / 0.15)", color: "hsl(0 84% 70%)",
                      border: "1px solid hsl(0 84% 50% / 0.3)", borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    <RefreshCw size={11} style={{ display: "inline", marginRight: 4 }} />
                    Reset
                  </button>
                </Row>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
