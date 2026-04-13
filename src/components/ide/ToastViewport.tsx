/**
 * ToastViewport — fixed-position stack of editorial-terminal toast notifications.
 * Mounted once at the IDELayout root. Subscribes to NotificationContext.toasts.
 */

import { useEffect } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import { useNotifications, type Toast } from "@/contexts/NotificationContext";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

const TYPE_STYLE: Record<Toast["type"], { color: string; icon: React.ReactNode; label: string }> = {
  success: { color: C.accent, icon: <CheckCircle2 size={13} />, label: "OK" },
  info:    { color: C.info,   icon: <Info size={13} />,         label: "INFO" },
  warning: { color: C.warn,   icon: <AlertTriangle size={13} />, label: "WARN" },
  error:   { color: C.error,  icon: <AlertCircle size={13} />,   label: "ERROR" },
};

export function ToastViewport() {
  const { toasts, dismissToast } = useNotifications();
  useEffect(() => { injectFonts(); }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 50,
        right: 16,
        zIndex: 100000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      {toasts.map((toast) => {
        const style = TYPE_STYLE[toast.type];
        return (
          <div
            key={toast.id}
            style={{
              pointerEvents: "auto",
              minWidth: 260,
              maxWidth: 380,
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderLeft: `2px solid ${style.color}`,
              borderRadius: 4,
              padding: "10px 14px",
              boxShadow: "0 12px 32px rgba(0, 0, 0, 0.6)",
              fontFamily: FONTS.sans,
              animation: "pipilot-toast-in 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: toast.message ? 6 : 0 }}>
              <span style={{ color: style.color, flexShrink: 0, display: "flex" }}>
                {style.icon}
              </span>
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 9,
                  fontWeight: 500,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: style.color,
                  flexShrink: 0,
                }}
              >
                / {style.label}
              </span>
              <span
                style={{
                  flex: 1,
                  fontFamily: FONTS.sans,
                  fontSize: 12,
                  fontWeight: 500,
                  color: C.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                }}
                title={toast.title}
              >
                {toast.title}
              </span>
              <button
                onClick={() => dismissToast(toast.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 18,
                  height: 18,
                  background: "transparent",
                  border: "none",
                  borderRadius: 2,
                  color: C.textDim,
                  cursor: "pointer",
                  flexShrink: 0,
                  opacity: 0.6,
                  transition: "opacity 0.12s, color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "1";
                  e.currentTarget.style.color = C.text;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "0.6";
                  e.currentTarget.style.color = C.textDim;
                }}
              >
                <X size={11} />
              </button>
            </div>
            {toast.message && (
              <div
                style={{
                  fontFamily: FONTS.sans,
                  fontSize: 12,
                  color: C.textMid,
                  lineHeight: 1.5,
                  marginLeft: 23,
                }}
              >
                {toast.message}
              </div>
            )}
          </div>
        );
      })}

      <style>{`
        @keyframes pipilot-toast-in {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
