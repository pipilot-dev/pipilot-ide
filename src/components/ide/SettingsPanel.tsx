import { useState } from "react";
import { createPortal } from "react-dom";
import { Type, Palette, Bot, Keyboard, X } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const tabs = [
  { id: "editor", label: "Editor", icon: Type },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "ai", label: "AI", icon: Bot },
  { id: "shortcuts", label: "Keyboard Shortcuts", icon: Keyboard },
] as const;

type TabId = (typeof tabs)[number]["id"];

const colors = {
  bg: "hsl(220 13% 15%)",
  sidebar: "hsl(220 13% 12%)",
  active: "hsl(207 90% 54%)",
  text: "hsl(220 14% 85%)",
  textMuted: "hsl(220 14% 60%)",
  inputBg: "hsl(220 13% 20%)",
  border: "hsl(220 13% 25%)",
  overlay: "rgba(0, 0, 0, 0.5)",
};

const fontFamilyOptions = [
  { value: '"Fira Code", monospace', label: "Fira Code" },
  { value: '"Cascadia Code", monospace', label: "Cascadia Code" },
  { value: '"JetBrains Mono", monospace', label: "JetBrains Mono" },
  { value: '"Source Code Pro", monospace', label: "Source Code Pro" },
  { value: "Consolas, monospace", label: "Consolas" },
  { value: "monospace", label: "monospace" },
];

const shortcuts = [
  { keys: ["Ctrl", "P"], description: "Command Palette" },
  { keys: ["Ctrl", "Shift", "I"], description: "Toggle AI Chat" },
  { keys: ["Ctrl", "`"], description: "Toggle Terminal" },
  { keys: ["Ctrl", "B"], description: "Toggle Sidebar" },
  { keys: ["Ctrl", ","], description: "Settings" },
];

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("editor");
  const { get, set } = useSettings();

  if (!open) return null;

  const inputStyle: React.CSSProperties = {
    background: colors.inputBg,
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    color: colors.text,
    padding: "6px 10px",
    fontSize: 13,
    outline: "none",
    width: "100%",
  };

  const labelStyle: React.CSSProperties = {
    color: colors.text,
    fontSize: 13,
    fontWeight: 500,
    marginBottom: 6,
    display: "block",
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  };

  const modal = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: colors.overlay,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 700,
          height: 500,
          background: colors.bg,
          borderRadius: 8,
          border: `1px solid ${colors.border}`,
          display: "flex",
          overflow: "hidden",
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
        }}
      >
        {/* Sidebar */}
        <div
          style={{
            width: 200,
            background: colors.sidebar,
            borderRight: `1px solid ${colors.border}`,
            display: "flex",
            flexDirection: "column",
            padding: "16px 0",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: "0 16px 16px",
              fontSize: 14,
              fontWeight: 600,
              color: colors.text,
              borderBottom: `1px solid ${colors.border}`,
              marginBottom: 8,
            }}
          >
            Settings
          </div>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 16px",
                  margin: "2px 8px",
                  borderRadius: 4,
                  border: "none",
                  background: isActive ? colors.active : "transparent",
                  color: isActive ? "#fff" : colors.textMuted,
                  cursor: "pointer",
                  fontSize: 13,
                  textAlign: "left",
                  transition: "background 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = colors.inputBg;
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = "transparent";
                }}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 20px",
              borderBottom: `1px solid ${colors.border}`,
              flexShrink: 0,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: colors.text }}>
              {tabs.find((t) => t.id === activeTab)?.label}
            </h2>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: colors.textMuted,
                cursor: "pointer",
                padding: 4,
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = colors.text)}
              onMouseLeave={(e) => (e.currentTarget.style.color = colors.textMuted)}
            >
              <X size={18} />
            </button>
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
            {activeTab === "editor" && (
              <EditorTab get={get} set={set} inputStyle={inputStyle} labelStyle={labelStyle} rowStyle={rowStyle} />
            )}
            {activeTab === "appearance" && (
              <AppearanceTab get={get} set={set} labelStyle={labelStyle} rowStyle={rowStyle} />
            )}
            {activeTab === "ai" && <AITab />}
            {activeTab === "shortcuts" && <ShortcutsTab />}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

/* ---- Editor Tab ---- */

function EditorTab({
  get,
  set,
  inputStyle,
  labelStyle,
  rowStyle,
}: {
  get: (k: string) => string;
  set: (k: string, v: string) => Promise<void>;
  inputStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  rowStyle: React.CSSProperties;
}) {
  return (
    <div>
      {/* Font Size */}
      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>Font Size</label>
        <input
          type="number"
          min={10}
          max={32}
          value={get("editorFontSize") || "14"}
          onChange={(e) => {
            const v = Math.max(10, Math.min(32, Number(e.target.value)));
            set("editorFontSize", String(v));
          }}
          style={{ ...inputStyle, width: 80, textAlign: "center" }}
        />
      </div>

      {/* Font Family */}
      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>Font Family</label>
        <select
          value={get("editorFontFamily") || '"Fira Code", monospace'}
          onChange={(e) => set("editorFontFamily", e.target.value)}
          style={{ ...inputStyle, width: 220, cursor: "pointer" }}
        >
          {fontFamilyOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Tab Size */}
      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>Tab Size</label>
        <div style={{ display: "flex", gap: 12 }}>
          {["2", "4"].map((size) => (
            <label
              key={size}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                color: colors.text,
                fontSize: 13,
              }}
            >
              <input
                type="radio"
                name="tabSize"
                value={size}
                checked={(get("editorTabSize") || "2") === size}
                onChange={() => set("editorTabSize", size)}
                style={{ accentColor: colors.active }}
              />
              {size} spaces
            </label>
          ))}
        </div>
      </div>

      {/* Word Wrap */}
      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>Word Wrap</label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            color: colors.text,
            fontSize: 13,
          }}
        >
          <input
            type="checkbox"
            checked={(get("editorWordWrap") || "on") === "on"}
            onChange={(e) => set("editorWordWrap", e.target.checked ? "on" : "off")}
            style={{ accentColor: colors.active, width: 16, height: 16 }}
          />
          Enabled
        </label>
      </div>

      {/* Minimap */}
      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>Minimap</label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            color: colors.text,
            fontSize: 13,
          }}
        >
          <input
            type="checkbox"
            checked={get("editorMinimap") === "true"}
            onChange={(e) => set("editorMinimap", e.target.checked ? "true" : "false")}
            style={{ accentColor: colors.active, width: 16, height: 16 }}
          />
          Show minimap
        </label>
      </div>
    </div>
  );
}

/* ---- Appearance Tab ---- */

function AppearanceTab({
  get,
  set,
  labelStyle,
  rowStyle,
}: {
  get: (k: string) => string;
  set: (k: string, v: string) => Promise<void>;
  labelStyle: React.CSSProperties;
  rowStyle: React.CSSProperties;
}) {
  return (
    <div>
      <div style={rowStyle}>
        <label style={{ ...labelStyle, marginBottom: 0, flexShrink: 0 }}>Theme</label>
        <div style={{ display: "flex", gap: 12 }}>
          {(["dark", "light"] as const).map((theme) => (
            <label
              key={theme}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                color: colors.text,
                fontSize: 13,
                textTransform: "capitalize",
              }}
            >
              <input
                type="radio"
                name="theme"
                value={theme}
                checked={(get("theme") || "dark") === theme}
                onChange={() => set("theme", theme)}
                style={{ accentColor: colors.active }}
              />
              {theme}
            </label>
          ))}
        </div>
      </div>
      <p style={{ color: colors.textMuted, fontSize: 12, lineHeight: 1.6, marginTop: 8 }}>
        Theme switching affects the editor and UI color scheme. Some changes may require a reload to take full effect.
      </p>
    </div>
  );
}

/* ---- AI Tab ---- */

function AITab() {
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: colors.textMuted, fontSize: 12, marginBottom: 4 }}>Model</div>
        <div style={{ color: colors.text, fontSize: 14, fontWeight: 500 }}>
          PiPilot AI (via Kilo Gateway)
        </div>
      </div>
      <div
        style={{
          background: colors.inputBg,
          borderRadius: 6,
          padding: 16,
          border: `1px solid ${colors.border}`,
        }}
      >
        <p style={{ color: colors.text, fontSize: 13, lineHeight: 1.7, margin: 0 }}>
          PiPilot AI powers the integrated chat assistant, providing intelligent code suggestions,
          explanations, debugging help, and project-aware context. The AI can analyze your open files,
          terminal output, and project structure to deliver relevant assistance.
        </p>
        <p style={{ color: colors.textMuted, fontSize: 12, lineHeight: 1.6, margin: "12px 0 0" }}>
          AI requests are routed through the Kilo Code Gateway. No API key configuration is needed.
        </p>
      </div>
    </div>
  );
}

/* ---- Shortcuts Tab ---- */

function ShortcutsTab() {
  const kbdStyle: React.CSSProperties = {
    display: "inline-block",
    background: colors.inputBg,
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 12,
    fontFamily: "inherit",
    color: colors.text,
    minWidth: 24,
    textAlign: "center",
    lineHeight: "22px",
    boxShadow: `0 1px 0 ${colors.border}`,
  };

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th
              style={{
                textAlign: "left",
                color: colors.textMuted,
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                padding: "0 0 12px",
                borderBottom: `1px solid ${colors.border}`,
              }}
            >
              Shortcut
            </th>
            <th
              style={{
                textAlign: "left",
                color: colors.textMuted,
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                padding: "0 0 12px",
                borderBottom: `1px solid ${colors.border}`,
              }}
            >
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {shortcuts.map((sc, i) => (
            <tr key={i}>
              <td style={{ padding: "10px 0", borderBottom: `1px solid ${colors.border}` }}>
                <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {sc.keys.map((key, j) => (
                    <span key={j}>
                      <kbd style={kbdStyle}>{key}</kbd>
                      {j < sc.keys.length - 1 && (
                        <span style={{ color: colors.textMuted, margin: "0 2px", fontSize: 11 }}>+</span>
                      )}
                    </span>
                  ))}
                </span>
              </td>
              <td
                style={{
                  padding: "10px 0",
                  borderBottom: `1px solid ${colors.border}`,
                  color: colors.text,
                  fontSize: 13,
                }}
              >
                {sc.description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
