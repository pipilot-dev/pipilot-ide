import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Bell, X, CheckCheck, Trash2, Info, CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";
import { useNotifications, Notification } from "@/contexts/NotificationContext";

interface NotificationCenterProps {
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function NotificationCenter({ anchorRef }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markAllRead, clearAll, removeNotification } = useNotifications();
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, anchorRef]);

  // Auto mark read when opened
  useEffect(() => {
    if (open && unreadCount > 0) {
      const t = setTimeout(markAllRead, 2000);
      return () => clearTimeout(t);
    }
  }, [open, unreadCount, markAllRead]);

  // Build the bell button (rendered inline by the parent)
  // This component handles just the popover panel

  const typeIcon = (type: Notification["type"]) => {
    switch (type) {
      case "success": return <CheckCircle2 size={14} style={{ color: "hsl(142 71% 45%)" }} />;
      case "error": return <AlertCircle size={14} style={{ color: "hsl(0 84% 60%)" }} />;
      case "warning": return <AlertTriangle size={14} style={{ color: "hsl(38 92% 50%)" }} />;
      default: return <Info size={14} style={{ color: "hsl(207 90% 60%)" }} />;
    }
  };

  const timeAgo = (date: Date) => {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <>
      {/* Bell button */}
      <button
        ref={anchorRef as React.RefObject<HTMLButtonElement>}
        onClick={() => setOpen(!open)}
        style={{
          background: "none", border: "none", color: "inherit", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 2, padding: "0 6px", position: "relative",
          fontSize: 11, height: "100%",
        }}
        title="Notifications"
      >
        <Bell size={13} />
        {unreadCount > 0 && (
          <span style={{
            position: "absolute", top: 2, right: 2,
            width: 14, height: 14, borderRadius: "50%",
            background: "hsl(0 84% 60%)", color: "#fff",
            fontSize: 9, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            lineHeight: 1,
          }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Popover panel */}
      {open && createPortal(
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            bottom: 30, right: 60,
            width: 340, maxHeight: 420,
            background: "hsl(220 13% 18%)",
            border: "1px solid hsl(220 13% 25%)",
            borderRadius: 8,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            zIndex: 9999,
            display: "flex", flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 12px",
            borderBottom: "1px solid hsl(220 13% 25%)",
          }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: "hsl(220 14% 85%)" }}>Notifications</span>
            <div style={{ display: "flex", gap: 4 }}>
              {notifications.length > 0 && (
                <>
                  <button onClick={markAllRead} title="Mark all read"
                    style={{ background: "none", border: "none", color: "hsl(220 14% 55%)", cursor: "pointer", padding: 4 }}>
                    <CheckCheck size={14} />
                  </button>
                  <button onClick={clearAll} title="Clear all"
                    style={{ background: "none", border: "none", color: "hsl(220 14% 55%)", cursor: "pointer", padding: 4 }}>
                    <Trash2 size={14} />
                  </button>
                </>
              )}
              <button onClick={() => setOpen(false)} title="Close"
                style={{ background: "none", border: "none", color: "hsl(220 14% 55%)", cursor: "pointer", padding: 4 }}>
                <X size={14} />
              </button>
            </div>
          </div>

          {/* List */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {notifications.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "hsl(220 14% 45%)", fontSize: 12 }}>
                No notifications
              </div>
            ) : (
              notifications.map((n) => (
                <div key={n.id} style={{
                  display: "flex", gap: 8, padding: "8px 12px",
                  borderBottom: "1px solid hsl(220 13% 22%)",
                  background: n.read ? "transparent" : "hsl(220 13% 20%)",
                  alignItems: "flex-start",
                }}>
                  <div style={{ marginTop: 2 }}>{typeIcon(n.type)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "hsl(220 14% 85%)" }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: "hsl(220 14% 55%)", marginTop: 2 }}>{n.message}</div>
                    <div style={{ fontSize: 10, color: "hsl(220 14% 40%)", marginTop: 3 }}>{timeAgo(n.timestamp)}</div>
                  </div>
                  <button onClick={() => removeNotification(n.id)}
                    style={{ background: "none", border: "none", color: "hsl(220 14% 40%)", cursor: "pointer", padding: 2, flexShrink: 0 }}>
                    <X size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
