/**
 * CloneRepoModal — editorial-terminal styled git clone dialog.
 * Used by both WelcomePage and TitleBar (File → Clone Repository).
 */

import { useState, useEffect } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

interface CloneRepoModalProps {
  open: boolean;
  onClose: () => void;
  onCloned: (absolutePath: string) => void | Promise<void>;
}

export function CloneRepoModal({ open, onClose, onCloned }: CloneRepoModalProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { injectFonts(); }, []);
  useEffect(() => {
    if (open) { setUrl(""); setError(null); setBusy(false); }
  }, [open]);

  const handleClone = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!/^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/i.test(trimmed)) {
      setError("URL must start with https://, git@, ssh://, or git://");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/git/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Clone failed");
      if (data.path) await onCloned(data.path);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Clone failed");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: FONTS.sans,
      }}
    >
      <div style={{
        width: 580, maxWidth: "92vw",
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: 32,
        boxShadow: "0 24px 64px rgba(0, 0, 0, 0.7)",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Faint accent glow in corner */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -100, right: -100,
            width: 280, height: 280,
            background: `radial-gradient(circle, ${C.accent}10 0%, transparent 70%)`,
            pointerEvents: "none",
          }}
        />

        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <span style={{
              fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase", color: C.accent,
            }}>
              / GIT
            </span>
            <span style={{
              fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase", color: C.textDim,
            }}>
              Clone Repository
            </span>
          </div>

          <h3 style={{
            fontFamily: FONTS.display, fontSize: 36, fontWeight: 400,
            lineHeight: 1.05, color: C.text, margin: "0 0 14px 0",
          }}>
            pull a <span style={{ fontStyle: "italic", color: C.accent }}>repo</span>
            <span style={{ color: C.accent }}>.</span>
          </h3>

          <p style={{
            fontSize: 13, color: C.textMid, lineHeight: 1.6, margin: "0 0 22px 0",
            maxWidth: 460,
          }}>
            Enter a git URL. PiPilot will clone the repository to disk and open
            it as a linked workspace. Press <kbd style={kbdStyle}>↵</kbd> to start.
          </p>

          <div style={{ position: "relative", marginBottom: 12 }}>
            <GitBranch
              size={14}
              style={{
                position: "absolute", left: 14, top: "50%",
                transform: "translateY(-50%)", color: C.textDim,
                pointerEvents: "none",
              }}
            />
            <input
              type="text"
              autoFocus
              value={url}
              onChange={(e) => { setUrl(e.target.value); setError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) handleClone();
                if (e.key === "Escape") onClose();
              }}
              placeholder="https://github.com/user/repo.git"
              disabled={busy}
              style={{
                width: "100%", padding: "12px 14px 12px 38px",
                fontFamily: FONTS.mono, fontSize: 12,
                background: C.bg,
                color: C.text,
                border: `1px solid ${error ? "#ff6b6b55" : C.border}`,
                borderRadius: 5, outline: "none",
                caretColor: C.accent,
              }}
              onFocus={(e) => { if (!error) e.currentTarget.style.borderColor = C.accentLine; }}
              onBlur={(e) => { if (!error) e.currentTarget.style.borderColor = C.border; }}
            />
          </div>

          {error && (
            <div style={{
              padding: "10px 14px", marginBottom: 12,
              fontSize: 11, fontFamily: FONTS.mono,
              color: "#ff9b9b",
              background: "#ff6b6b12",
              border: "1px solid #ff6b6b33",
              borderRadius: 4,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button
              onClick={onClose}
              disabled={busy}
              style={{
                padding: "10px 18px",
                fontFamily: FONTS.mono, fontSize: 10, fontWeight: 500,
                letterSpacing: "0.12em", textTransform: "uppercase",
                background: "transparent",
                color: C.textMid,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleClone}
              disabled={!url.trim() || busy}
              style={{
                padding: "10px 22px",
                fontFamily: FONTS.mono, fontSize: 10, fontWeight: 600,
                letterSpacing: "0.12em", textTransform: "uppercase",
                background: (!url.trim() || busy) ? C.surfaceAlt : C.accent,
                color: (!url.trim() || busy) ? C.textDim : C.bg,
                border: `1px solid ${(!url.trim() || busy) ? C.border : C.accent}`,
                borderRadius: 4,
                cursor: (!url.trim() || busy) ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              {busy && <Loader2 size={11} className="animate-spin" />}
              {busy ? "Cloning…" : "Clone →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  fontFamily: FONTS.mono,
  padding: "1px 6px",
  border: `1px solid ${C.border}`,
  borderRadius: 3,
  background: C.bg,
  color: C.text,
  fontSize: 10,
};
