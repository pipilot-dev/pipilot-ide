/**
 * SessionPicker — multi-chat-session dropdown for the chat panel header.
 *
 * The dropdown is rendered via a portal (so it isn't clipped by parent
 * `overflow:hidden`) and dynamically positioned to fit the chat panel's
 * actual bounds. Width auto-shrinks to whatever's available so it can never
 * extend past the panel edge regardless of resize.
 *
 * Each row is single-line: truncated title (ellipsis), inline always-visible
 * action buttons (rename + delete) packed compactly. Sessions live in
 * `db.chatSessions` and the picker uses `useLiveQuery` to react to AI title
 * updates in real time.
 */

import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, Plus, MessageSquare, Trash2, Pencil, Check, X } from "lucide-react";
import { db } from "@/lib/db";
import { COLORS as C, FONTS } from "@/lib/design-tokens";

interface SessionPickerProps {
  projectId: string;
  currentSessionId: string;
  onSwitch: (sessionId: string) => void;
  onCreate: () => Promise<string> | string | void;
  onRename: (sessionId: string, name: string) => Promise<void> | void;
  onDelete: (sessionId: string) => Promise<void> | void;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
}

const PADDING = 8;     // viewport breathing room
const MIN_WIDTH = 180; // never go narrower than this
const MAX_WIDTH = 280; // never go wider than this
const PREFERRED = 240;

export function SessionPicker({
  projectId,
  currentSessionId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: SessionPickerProps) {
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pos, setPos] = useState<DropdownPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Live list of sessions for this project, sorted by updatedAt desc
  const sessions = useLiveQuery(async () => {
    if (!projectId) return [];
    const all = await db.chatSessions.where("projectId").equals(projectId).toArray();
    // Filter out multi-agent sessions — they have their own tab bar
    const list = all.filter((s) => !s.id.startsWith("multiagent-"));
    return list.sort((a, b) => {
      const ta = a.updatedAt instanceof Date ? a.updatedAt.getTime() : new Date(a.updatedAt).getTime();
      const tb = b.updatedAt instanceof Date ? b.updatedAt.getTime() : new Date(b.updatedAt).getTime();
      return tb - ta;
    });
  }, [projectId]) ?? [];

  const current = sessions.find((s) => s.id === currentSessionId);
  const currentFullLabel = current?.name || "New Chat";
  // Trigger label is hard-truncated to 12 chars + ellipsis as requested
  const currentLabel =
    currentFullLabel.length > 12 ? currentFullLabel.slice(0, 12) + "…" : currentFullLabel;

  // ── Compute dropdown position relative to viewport ──
  // Find the closest "panel" container (the chat panel) so we can clamp
  // the dropdown's horizontal range to the panel's actual bounds. This is
  // what makes the picker resize-safe — it never extends past the chat panel.
  const computePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();

    // Walk up to find the chat panel wrapper (data-testid="chat-panel-wrapper").
    // If we can't find it, fall back to the viewport.
    let bound: DOMRect | null = null;
    let el: HTMLElement | null = trigger;
    while (el) {
      if (el.dataset?.testid === "chat-panel-wrapper" || el.dataset?.testid === "chat-panel") {
        bound = el.getBoundingClientRect();
        break;
      }
      el = el.parentElement;
    }
    const leftBound = bound ? bound.left + PADDING : PADDING;
    const rightBound = bound ? bound.right - PADDING : window.innerWidth - PADDING;
    const available = Math.max(MIN_WIDTH, rightBound - leftBound);
    const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.min(PREFERRED, available)));

    // Right-align to the trigger's right edge by default, then clamp.
    let left = rect.right - width;
    if (left < leftBound) left = leftBound;
    if (left + width > rightBound) left = rightBound - width;

    return { top: rect.bottom + 4, left, width };
  };

  useLayoutEffect(() => {
    if (!open) return;
    setPos(computePosition());
    // Recompute on scroll/resize — keeps the dropdown glued to the trigger
    const onUpdate = () => setPos(computePosition());
    window.addEventListener("resize", onUpdate);
    window.addEventListener("scroll", onUpdate, true);
    return () => {
      window.removeEventListener("resize", onUpdate);
      window.removeEventListener("scroll", onUpdate, true);
    };
  }, [open]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(t) &&
        dropdownRef.current && !dropdownRef.current.contains(t)
      ) {
        setOpen(false);
        setRenamingId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setRenamingId(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleNew = async () => {
    await onCreate();
    setOpen(false);
  };

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  };

  const submitRename = async () => {
    if (renamingId && renameValue.trim()) {
      await onRename(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const handleDelete = async (id: string) => {
    if (sessions.length <= 1) {
      if (!confirm("This is the only session. Delete will clear all messages instead.")) return;
    } else {
      if (!confirm("Delete this chat session?")) return;
    }
    await onDelete(id);
  };

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((p) => !p)}
        title={currentFullLabel}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 6px",
          background: open ? C.surfaceAlt : "transparent",
          border: `1px solid ${open ? C.accentLine : C.border}`,
          borderRadius: 3,
          color: C.textMid,
          fontFamily: FONTS.mono,
          fontSize: 9,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <MessageSquare size={9} style={{ color: C.accent, flexShrink: 0 }} />
        <span style={{ color: C.text, whiteSpace: "nowrap" }}>{currentLabel}</span>
        <ChevronDown size={8} style={{ opacity: 0.6, flexShrink: 0 }} />
      </button>

      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: pos.width,
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.6)",
            zIndex: 9999,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            maxHeight: "min(420px, calc(100vh - 80px))",
            fontFamily: FONTS.sans,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 11px",
              borderBottom: `1px solid ${C.border}`,
              background: C.surfaceAlt,
              flexShrink: 0,
            }}
          >
            <span style={{
              fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase", color: C.accent,
            }}>
              / S
            </span>
            <span style={{
              fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase", color: C.textDim,
            }}>
              Sessions
            </span>
            <span style={{
              fontFamily: FONTS.mono, fontSize: 9,
              color: C.textFaint, marginLeft: "auto",
            }}>
              {String(sessions.length).padStart(2, "0")}
            </span>
          </div>

          {/* Session list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "3px 0", minHeight: 0 }}>
            {sessions.length === 0 && (
              <div style={{
                padding: "14px 12px", fontFamily: FONTS.mono, fontSize: 10, color: C.textDim,
              }}>
                // no sessions
              </div>
            )}
            {sessions.map((s) => {
              const isActive = s.id === currentSessionId;
              const isRenaming = renamingId === s.id;
              return (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 8px 5px 10px",
                    background: isActive ? C.accentDim : "transparent",
                    borderLeft: `2px solid ${isActive ? C.accent : "transparent"}`,
                    cursor: isRenaming ? "default" : "pointer",
                    transition: "background 0.12s",
                    minWidth: 0,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive && !isRenaming) {
                      (e.currentTarget as HTMLElement).style.background = C.surfaceAlt;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive && !isRenaming) {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                    }
                  }}
                  onClick={() => {
                    if (isRenaming) return;
                    onSwitch(s.id);
                    setOpen(false);
                  }}
                >
                  <MessageSquare
                    size={10}
                    style={{
                      color: isActive ? C.accent : C.textDim,
                      flexShrink: 0,
                    }}
                  />

                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") submitRename();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        flex: 1,
                        background: C.bg,
                        border: `1px solid ${C.accent}`,
                        borderRadius: 2,
                        padding: "1px 5px",
                        fontFamily: FONTS.mono,
                        fontSize: 10,
                        color: C.text,
                        outline: "none",
                        caretColor: C.accent,
                        minWidth: 0,
                      }}
                    />
                  ) : (
                    <span
                      title={s.name || "New Chat"}
                      style={{
                        flex: 1,
                        fontFamily: FONTS.mono,
                        fontSize: 10,
                        color: isActive ? C.accent : C.textMid,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                      }}
                    >
                      {s.name || "New Chat"}
                    </span>
                  )}

                  {/* Action buttons — always visible, compact */}
                  <div style={{ display: "flex", gap: 1, flexShrink: 0 }}>
                    {isRenaming ? (
                      <>
                        <IconBtn
                          icon={<Check size={10} />}
                          title="Save"
                          onClick={(e) => { e.stopPropagation(); submitRename(); }}
                          accent
                        />
                        <IconBtn
                          icon={<X size={10} />}
                          title="Cancel"
                          onClick={(e) => { e.stopPropagation(); setRenamingId(null); }}
                        />
                      </>
                    ) : (
                      <>
                        <IconBtn
                          icon={<Pencil size={9} />}
                          title="Rename"
                          onClick={(e) => { e.stopPropagation(); startRename(s.id, s.name || ""); }}
                        />
                        <IconBtn
                          icon={<Trash2 size={9} />}
                          title="Delete"
                          onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                          danger
                        />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* New chat button */}
          <button
            onClick={handleNew}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "7px 11px",
              background: "transparent",
              border: "none",
              borderTop: `1px solid ${C.border}`,
              color: C.accent,
              fontFamily: FONTS.mono,
              fontSize: 9,
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: "pointer",
              transition: "background 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <Plus size={10} />
            New Chat
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

function IconBtn({
  icon, title, onClick, accent, danger,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        background: "transparent",
        border: "none",
        borderRadius: 2,
        color: accent ? C.accent : C.textDim,
        cursor: "pointer",
        opacity: 0.65,
        transition: "opacity 0.12s, color 0.12s, background 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = "1";
        e.currentTarget.style.background = C.bg;
        e.currentTarget.style.color = danger ? "#ff9b9b" : accent ? C.accent : C.text;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = "0.65";
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = accent ? C.accent : C.textDim;
      }}
    >
      {icon}
    </button>
  );
}
