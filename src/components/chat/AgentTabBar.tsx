/**
 * AgentTabBar — horizontal tab strip for multi-agent spawning.
 * Sits between the chat header and the message area.
 * Each tab represents an independent agent with its own session.
 */

import { useState, useRef, useEffect } from "react";
import { Plus, X, Bot, Pencil, Check } from "lucide-react";
import { COLORS as C, FONTS } from "@/lib/design-tokens";
import type { AgentTab } from "@/hooks/useMultiAgent";

interface AgentTabBarProps {
  tabs: AgentTab[];
  activeTabId: string;
  onSwitch: (tabId: string) => void;
  onCreate: (name?: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, name: string) => void;
}

export function AgentTabBar({ tabs, activeTabId, onSwitch, onCreate, onClose, onRename }: AgentTabBarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  // Only show tab bar if there are 2+ tabs
  if (tabs.length <= 1) return null;

  const statusColor = (status: AgentTab["status"]) => {
    switch (status) {
      case "streaming": return "#22c55e";
      case "working": return C.accent;
      case "error": return C.error;
      default: return C.textFaint;
    }
  };

  return (
    <div style={{
      display: "flex", alignItems: "center",
      borderBottom: `1px solid ${C.border}`,
      background: C.bg,
      flexShrink: 0,
      height: 30,
      overflow: "hidden",
    }}>
      {/* Scrollable tab area */}
      <div ref={scrollRef} style={{
        flex: 1, display: "flex", alignItems: "center",
        overflowX: "auto", overflowY: "hidden",
        scrollbarWidth: "none",
        gap: 0,
      }}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isEditing = editingId === tab.id;

          return (
            <div
              key={tab.id}
              onClick={() => { if (!isEditing) onSwitch(tab.id); }}
              onDoubleClick={() => {
                setEditingId(tab.id);
                setEditValue(tab.name);
              }}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "0 10px", height: 30,
                background: isActive ? C.surface : "transparent",
                borderRight: `1px solid ${C.border}`,
                cursor: "pointer",
                transition: "background 0.12s",
                flexShrink: 0,
                borderBottom: isActive ? `2px solid ${C.accent}` : "2px solid transparent",
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = C.surfaceAlt; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
            >
              {/* Status dot */}
              <span style={{
                width: 5, height: 5, borderRadius: 5,
                background: statusColor(tab.status),
                flexShrink: 0,
                boxShadow: tab.status === "streaming" || tab.status === "working"
                  ? `0 0 4px ${statusColor(tab.status)}60` : "none",
              }} />

              {/* Name (editable on double-click) */}
              {isEditing ? (
                <input
                  ref={editRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { onRename(tab.id, editValue.trim() || tab.name); setEditingId(null); }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => { onRename(tab.id, editValue.trim() || tab.name); setEditingId(null); }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: 70, padding: "1px 4px",
                    background: C.bg, border: `1px solid ${C.accent}`,
                    borderRadius: 2, color: C.text,
                    fontFamily: FONTS.mono, fontSize: 9,
                    outline: "none",
                  }}
                />
              ) : (
                <span style={{
                  fontFamily: FONTS.mono, fontSize: 9, fontWeight: isActive ? 600 : 500,
                  color: isActive ? C.text : C.textMid,
                  maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {tab.name}
                </span>
              )}

              {/* Close button (not on the only tab) */}
              {tabs.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                  style={{
                    background: "none", border: "none", padding: 0,
                    color: C.textFaint, cursor: "pointer",
                    display: "flex", alignItems: "center",
                    opacity: 0.5, transition: "opacity 0.12s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = C.text; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; e.currentTarget.style.color = C.textFaint; }}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* New agent button */}
      <button
        onClick={() => onCreate()}
        title="Spawn new agent"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 28, height: 30,
          background: "transparent", border: "none", borderLeft: `1px solid ${C.border}`,
          color: C.textDim, cursor: "pointer",
          transition: "color 0.12s",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = C.accent; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = C.textDim; }}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
