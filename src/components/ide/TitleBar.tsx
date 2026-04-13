/**
 * TitleBar — VS Code-style top toolbar.
 *
 * Layout:  [logo] [project switcher]    [File] [Edit] [View] [Run] [Terminal] [Help]    [⌘P search] [settings]
 *
 * All menu items are wired to real handlers (or to the same custom events the
 * rest of the IDE already uses, like `pipilot:new-file`, `pipilot:open-chat`).
 */

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  ChevronDown, Search, Settings as SettingsIcon, Folder, Check,
  PanelLeft, PanelBottom, MessageSquare,
} from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useActiveProject } from "@/contexts/ProjectContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

export interface TitleBarHandlers {
  // File
  onNewFile: () => void;
  onNewFolder: () => void;
  onOpenFolder: () => void;
  onCloneRepo: () => void;
  onSaveFile: () => void;
  onSaveAll: () => void;
  onCloseTab: () => void;
  onCloseAllTabs: () => void;
  onOpenSettings: () => void;
  // Edit
  onUndo: () => void;
  onRedo: () => void;
  onFind: () => void;
  onReplace: () => void;
  // View
  onToggleSidebar: () => void;
  onToggleTerminal: () => void;
  onToggleChat: () => void;
  onCommandPalette: () => void;
  onOpenExplorer: () => void;
  onOpenSearch: () => void;
  onOpenSourceControl: () => void;
  onOpenProblems: () => void;
  onOpenExtensions: () => void;
  // Run
  onRunPreview: () => void;
  onDeploy: () => void;
  // Terminal
  onNewTerminal: () => void;
  // Help
  onWelcome: () => void;
  onKeyboardShortcuts: () => void;
  // Active panel state — drives the highlight on the layout toggle cluster
  sidebarOpen?: boolean;
  terminalOpen?: boolean;
  chatOpen?: boolean;
}

interface MenuAction {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  separator?: false;
  submenu?: undefined;
}
interface Separator { separator: true; }
interface SubmenuItem {
  label: string;
  submenu: SubmenuEntry[];
  disabled?: boolean;
  separator?: false;
  onClick?: undefined;
}
interface SubmenuEntry {
  label: string;
  detail?: string;      // right-aligned secondary line (e.g. linked path, relative time)
  badge?: string;       // small pill before the label (e.g. "LINKED", "CLOSED")
  badgeColor?: string;
  onClick: () => void;
}
type MenuItem = MenuAction | Separator | SubmenuItem;

interface MenuDef {
  label: string;
  items: MenuItem[];
}

// Shortens an absolute path for display in the Recent submenu.
// Keeps the last ~2 segments and elides with ellipsis if too long.
function shortenPath(p: string): string {
  if (!p) return "";
  const norm = p.replace(/\\/g, "/");
  const parts = norm.split("/").filter(Boolean);
  if (parts.length <= 2) return norm;
  const tail = parts.slice(-2).join("/");
  return `…/${tail}`;
}

export function TitleBar(props: TitleBarHandlers) {
  useEffect(() => { injectFonts(); }, []);
  const { projects, allProjects, reopenProject } = useProjects();
  const { addNotification } = useNotifications();
  const { activeProjectId, switchProject } = useActiveProject();
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [showProjectSwitcher, setShowProjectSwitcher] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close any open menu/dropdown on outside click or Escape
  useEffect(() => {
    if (!openMenu && !showProjectSwitcher) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpenMenu(null);
        setOpenSubmenu(null);
        setShowProjectSwitcher(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu(null);
        setOpenSubmenu(null);
        setShowProjectSwitcher(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu, showProjectSwitcher]);

  // Helper that closes the menu after running an action
  const run = useCallback((fn: () => void) => () => {
    setOpenMenu(null);
    setOpenSubmenu(null);
    fn();
  }, []);

  // ── Build Recent submenu ──
  // Includes both open and soft-closed projects, sorted by updatedAt desc.
  const recentSubmenu: SubmenuEntry[] = useMemo(() => {
    const list = [...allProjects]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 40); // cap at 40 most-recent
    return list.map((p) => {
      const isClosed = !!p.closedAt;
      const isActive = !isClosed && p.id === activeProjectId;
      const typeBadge =
        p.type === "linked" ? "LINKED"
          : p.type === "cloud" ? "CLOUD"
          : p.type === "nodebox" ? "NODE"
          : "STATIC";
      const badgeColor =
        p.type === "linked" ? "hsl(47 95% 60%)"
          : p.type === "cloud" ? "hsl(280 65% 60%)"
          : p.type === "nodebox" ? "hsl(142 71% 50%)"
          : "hsl(207 90% 60%)";
      const detail = p.type === "linked" && p.linkedPath
        ? shortenPath(p.linkedPath)
        : (p.template || p.type);
      return {
        label: isActive ? `✓ ${p.name}` : p.name,
        detail,
        badge: isClosed ? "CLOSED" : typeBadge,
        badgeColor: isClosed ? "hsl(0 0% 50%)" : badgeColor,
        onClick: async () => {
          setOpenMenu(null);
          setOpenSubmenu(null);
          try {
            if (isClosed) {
              await reopenProject(p.id);
              addNotification({
                type: "success",
                title: "Project reopened",
                message: p.name,
              });
            } else if (!isActive) {
              await switchProject(p.id);
            }
          } catch (err) {
            addNotification({
              type: "error",
              title: "Failed to open project",
              message: err instanceof Error ? err.message : String(err),
            });
          }
        },
      };
    });
  }, [allProjects, activeProjectId, reopenProject, switchProject, addNotification]);

  const menus: MenuDef[] = useMemo(() => [
    {
      label: "File",
      items: [
        { label: "New File", shortcut: "⌘N", onClick: run(props.onNewFile) },
        { label: "New Folder", onClick: run(props.onNewFolder) },
        { separator: true },
        { label: "Open Folder…", shortcut: "⌘O", onClick: run(props.onOpenFolder) },
        { label: "Clone Repository…", onClick: run(props.onCloneRepo) },
        {
          label: "Recent",
          submenu: recentSubmenu,
          disabled: recentSubmenu.length === 0,
        },
        { separator: true },
        { label: "Save", shortcut: "⌘S", onClick: run(props.onSaveFile) },
        { label: "Save All", shortcut: "⌘⌥S", onClick: run(props.onSaveAll) },
        { separator: true },
        { label: "Close Tab", shortcut: "⌘W", onClick: run(props.onCloseTab) },
        { label: "Close All Tabs", onClick: run(props.onCloseAllTabs) },
        { separator: true },
        { label: "Settings", shortcut: "⌘,", onClick: run(props.onOpenSettings) },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "⌘Z", onClick: run(props.onUndo) },
        { label: "Redo", shortcut: "⌘⇧Z", onClick: run(props.onRedo) },
        { separator: true },
        { label: "Find", shortcut: "⌘F", onClick: run(props.onFind) },
        { label: "Replace", shortcut: "⌘H", onClick: run(props.onReplace) },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Command Palette…", shortcut: "⌘P", onClick: run(props.onCommandPalette) },
        { separator: true },
        { label: "Explorer", onClick: run(props.onOpenExplorer) },
        { label: "Search", onClick: run(props.onOpenSearch) },
        { label: "Source Control", onClick: run(props.onOpenSourceControl) },
        { label: "Problems", onClick: run(props.onOpenProblems) },
        { label: "Extensions", onClick: run(props.onOpenExtensions) },
        { separator: true },
        { label: "Toggle Sidebar", shortcut: "⌘B", onClick: run(props.onToggleSidebar) },
        { label: "Toggle Terminal", shortcut: "⌘`", onClick: run(props.onToggleTerminal) },
        { label: "Toggle AI Chat", shortcut: "⌘⇧I", onClick: run(props.onToggleChat) },
      ],
    },
    {
      label: "Run",
      items: [
        { label: "Open Preview", onClick: run(props.onRunPreview) },
        { separator: true },
        { label: "Deploy Project", onClick: run(props.onDeploy) },
      ],
    },
    {
      label: "Terminal",
      items: [
        { label: "New Terminal", shortcut: "⌘`", onClick: run(props.onNewTerminal) },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Welcome", onClick: run(props.onWelcome) },
        { label: "Keyboard Shortcuts", onClick: run(props.onKeyboardShortcuts) },
      ],
    },
  ], [props, run]);

  return (
    <div
      ref={containerRef}
      data-testid="title-bar"
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "stretch",
        height: 34,
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
        fontFamily: FONTS.mono,
        fontSize: 11,
        color: C.textMid,
        userSelect: "none",
        WebkitAppRegion: "drag" as any, // Will become useful in Electron
      }}
    >
      {/* ── Left: logo + project switcher ── */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "0 12px",
          borderRight: `1px solid ${C.border}`,
          WebkitAppRegion: "no-drag" as any,
        }}
      >
        <img
          src="/logo.png"
          alt="PiPilot"
          style={{ width: 16, height: 16, objectFit: "contain" }}
        />
        <span
          style={{
            fontWeight: 500,
            color: C.text,
            letterSpacing: "0.05em",
            fontSize: 10,
            textTransform: "uppercase",
          }}
        >
          PiPilot
        </span>
      </div>

      {/* Project switcher */}
      <div
        style={{
          position: "relative",
          display: "flex", alignItems: "center",
          padding: "0 10px",
          borderRight: `1px solid ${C.border}`,
          WebkitAppRegion: "no-drag" as any,
        }}
      >
        <button
          onClick={() => { setShowProjectSwitcher((p) => !p); setOpenMenu(null); }}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 8px",
            background: showProjectSwitcher ? C.surfaceAlt : "transparent",
            border: "none",
            borderRadius: 3,
            color: activeProject ? C.text : C.textDim,
            fontFamily: FONTS.mono, fontSize: 10,
            cursor: "pointer",
          }}
        >
          <Folder size={11} />
          <span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {activeProject?.name || "No project"}
          </span>
          <ChevronDown size={10} style={{ opacity: 0.6 }} />
        </button>

        {showProjectSwitcher && (
          <DropdownPanel>
            <div style={dropdownHeaderStyle}>// PROJECTS ({String(projects.length).padStart(2, "0")})</div>
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {projects.length === 0 && (
                <div style={{ padding: "10px 14px", color: C.textDim, fontSize: 10 }}>
                  No projects yet — open a folder to start.
                </div>
              )}
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { switchProject(p.id); setShowProjectSwitcher(false); }}
                  style={{
                    width: "100%",
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 12px",
                    background: "transparent", border: "none",
                    color: p.id === activeProjectId ? C.accent : C.textMid,
                    fontFamily: FONTS.mono, fontSize: 10,
                    cursor: "pointer", textAlign: "left",
                    minWidth: 260,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  {p.id === activeProjectId
                    ? <Check size={11} style={{ flexShrink: 0 }} />
                    : <span style={{ width: 11, flexShrink: 0 }} />}
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                  </span>
                  <span style={{ color: C.textDim, fontSize: 9 }}>{p.type}</span>
                </button>
              ))}
            </div>
          </DropdownPanel>
        )}
      </div>

      {/* ── Center: menu bar ── */}
      <div style={{ display: "flex", alignItems: "stretch", WebkitAppRegion: "no-drag" as any }}>
        {menus.map((menu) => (
          <div key={menu.label} style={{ position: "relative" }}>
            <button
              onClick={() => { setOpenMenu((p) => p === menu.label ? null : menu.label); setShowProjectSwitcher(false); }}
              onMouseEnter={() => { if (openMenu) setOpenMenu(menu.label); }}
              style={{
                height: "100%",
                padding: "0 12px",
                background: openMenu === menu.label ? C.surfaceAlt : "transparent",
                border: "none",
                color: openMenu === menu.label ? C.text : C.textMid,
                fontFamily: FONTS.mono, fontSize: 10,
                letterSpacing: "0.05em",
                cursor: "pointer",
              }}
            >
              {menu.label}
            </button>
            {openMenu === menu.label && (
              <DropdownPanel>
                {menu.items.map((item, i) => {
                  if ("separator" in item && item.separator) {
                    return <div key={`sep-${i}`} style={{ height: 1, background: C.border, margin: "4px 0" }} />;
                  }

                  // Submenu item (e.g. File → Recent)
                  if ("submenu" in item && item.submenu) {
                    const si = item as SubmenuItem;
                    const subKey = `${menu.label}:${si.label}`;
                    const isOpenSub = openSubmenu === subKey;
                    return (
                      <div
                        key={si.label}
                        style={{ position: "relative" }}
                        onMouseEnter={() => { if (!si.disabled) setOpenSubmenu(subKey); }}
                        onMouseLeave={() => setOpenSubmenu(null)}
                      >
                        <button
                          disabled={si.disabled}
                          style={{
                            width: "100%",
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            gap: 24,
                            padding: "6px 14px",
                            background: isOpenSub ? C.surfaceAlt : "transparent",
                            border: "none",
                            color: si.disabled ? C.textFaint : (isOpenSub ? C.accent : C.textMid),
                            fontFamily: FONTS.mono, fontSize: 10,
                            cursor: si.disabled ? "not-allowed" : "pointer",
                            textAlign: "left",
                            minWidth: 220,
                          }}
                        >
                          <span>{si.label}{si.disabled ? " (empty)" : ""}</span>
                          <span style={{ color: C.textDim, fontSize: 9 }}>▸</span>
                        </button>

                        {isOpenSub && si.submenu.length > 0 && (
                          <div
                            style={{
                              position: "absolute",
                              top: 0,
                              left: "100%",
                              marginLeft: 2,
                              background: C.surface,
                              border: `1px solid ${C.border}`,
                              borderRadius: 3,
                              minWidth: 320,
                              maxWidth: 480,
                              maxHeight: 360,
                              overflowY: "auto",
                              overflowX: "hidden",
                              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                              padding: "4px 0",
                              zIndex: 10001,
                            }}
                            onMouseEnter={() => setOpenSubmenu(subKey)}
                          >
                            {si.submenu.map((entry, j) => (
                              <button
                                key={`${entry.label}-${j}`}
                                onClick={entry.onClick}
                                style={{
                                  width: "100%",
                                  display: "grid",
                                  gridTemplateColumns: "auto 1fr auto",
                                  alignItems: "center",
                                  gap: 8,
                                  padding: "7px 12px",
                                  background: "transparent", border: "none",
                                  color: C.textMid,
                                  fontFamily: FONTS.mono, fontSize: 10,
                                  cursor: "pointer",
                                  textAlign: "left",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = C.surfaceAlt;
                                  e.currentTarget.style.color = C.accent;
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = "transparent";
                                  e.currentTarget.style.color = C.textMid;
                                }}
                              >
                                {entry.badge ? (
                                  <span
                                    style={{
                                      fontSize: 7,
                                      padding: "2px 5px",
                                      borderRadius: 2,
                                      background: `${entry.badgeColor || C.textDim}22`,
                                      color: entry.badgeColor || C.textDim,
                                      letterSpacing: "0.08em",
                                      fontWeight: 700,
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {entry.badge}
                                  </span>
                                ) : <span />}
                                <span
                                  style={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {entry.label}
                                </span>
                                {entry.detail && (
                                  <span
                                    style={{
                                      color: C.textDim,
                                      fontSize: 9,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      maxWidth: 180,
                                    }}
                                    title={entry.detail}
                                  >
                                    {entry.detail}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }

                  const ai = item as MenuAction;
                  return (
                    <button
                      key={ai.label}
                      onClick={ai.onClick}
                      disabled={ai.disabled}
                      onMouseEnter={(e) => {
                        setOpenSubmenu(null);
                        if (!ai.disabled) {
                          e.currentTarget.style.background = C.surfaceAlt;
                          e.currentTarget.style.color = C.accent;
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = ai.disabled ? C.textFaint : C.textMid;
                      }}
                      style={{
                        width: "100%",
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        gap: 24,
                        padding: "6px 14px",
                        background: "transparent", border: "none",
                        color: ai.disabled ? C.textFaint : C.textMid,
                        fontFamily: FONTS.mono, fontSize: 10,
                        cursor: ai.disabled ? "not-allowed" : "pointer",
                        textAlign: "left",
                        minWidth: 220,
                      }}
                    >
                      <span>{ai.label}</span>
                      {ai.shortcut && (
                        <span style={{ color: C.textDim, fontSize: 9, letterSpacing: "0.04em" }}>
                          {ai.shortcut}
                        </span>
                      )}
                    </button>
                  );
                })}
              </DropdownPanel>
            )}
          </div>
        ))}
      </div>

      {/* ── Right: search trigger + settings ── */}
      <div style={{ flex: 1 }} />
      <div
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "0 8px",
          borderLeft: `1px solid ${C.border}`,
          WebkitAppRegion: "no-drag" as any,
        }}
      >
        <button
          onClick={props.onCommandPalette}
          title="Command Palette (⌘P)"
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 10px",
            background: C.surfaceAlt,
            border: `1px solid ${C.border}`,
            borderRadius: 3,
            color: C.textDim,
            fontFamily: FONTS.mono, fontSize: 10,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.borderHover; e.currentTarget.style.color = C.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textDim; }}
        >
          <Search size={11} />
          <span style={{ minWidth: 80 }}>Search files…</span>
          <kbd
            style={{
              padding: "1px 5px",
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: 2,
              fontSize: 9,
              color: C.textDim,
            }}
          >
            ⌘P
          </kbd>
        </button>

        {/* ── Layout toggle cluster (sidebar / terminal / chat) ── */}
        <div
          style={{
            display: "flex", alignItems: "center",
            marginLeft: 6,
            padding: "0 4px",
            borderLeft: `1px solid ${C.border}`,
          }}
        >
          <LayoutToggle
            label="Toggle Sidebar (⌘B)"
            active={!!props.sidebarOpen}
            onClick={props.onToggleSidebar}
            icon={<PanelLeft size={13} />}
          />
          <LayoutToggle
            label="Toggle Terminal (⌘`)"
            active={!!props.terminalOpen}
            onClick={props.onToggleTerminal}
            icon={<PanelBottom size={13} />}
          />
          <LayoutToggle
            label="Toggle AI Chat (⌘⇧I)"
            active={!!props.chatOpen}
            onClick={props.onToggleChat}
            icon={<MessageSquare size={12} />}
          />
        </div>

        <button
          onClick={props.onOpenSettings}
          title="Settings (⌘,)"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 26, height: 24,
            background: "transparent",
            border: "none", borderRadius: 3,
            color: C.textDim, cursor: "pointer",
            marginLeft: 4,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.color = C.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textDim; }}
        >
          <SettingsIcon size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * Single layout toggle button — used by the chat / sidebar / terminal cluster.
 * When `active` is true, it lights up with the lime accent + a bottom border,
 * matching VSCode's "panel is currently visible" affordance.
 */
function LayoutToggle({
  label, active, onClick, icon,
}: { label: string; active: boolean; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 24,
        background: active ? C.accentDim : "transparent",
        border: "none",
        borderRadius: 3,
        color: active ? C.accent : C.textDim,
        cursor: "pointer",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = C.surfaceAlt;
          e.currentTarget.style.color = C.text;
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = C.textDim;
        }
      }}
    >
      {icon}
      {active && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 4, right: 4, bottom: 1,
            height: 1.5,
            background: C.accent,
            borderRadius: 1,
          }}
        />
      )}
    </button>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

function DropdownPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: 1,
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 4,
        padding: "4px 0",
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.6)",
        zIndex: 9000,
        minWidth: 220,
      }}
    >
      {children}
    </div>
  );
}

const dropdownHeaderStyle: React.CSSProperties = {
  padding: "6px 14px",
  fontFamily: FONTS.mono,
  fontSize: 9,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: C.accent,
  borderBottom: `1px solid ${C.border}`,
  marginBottom: 4,
};
