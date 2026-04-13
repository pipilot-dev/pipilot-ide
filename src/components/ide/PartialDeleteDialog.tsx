/**
 * PartialDeleteDialog — shown when a project's disk folder couldn't be
 * removed (locked by an external process) but its contents were emptied.
 *
 * Mirrors the editorial-terminal aesthetic of the other modals (CloneRepoModal,
 * FolderPicker, HelpDialog). Includes the absolute folder path with a copy
 * button so the user can paste it into Explorer / `rm -rf` / etc. after
 * closing PiPilot IDE.
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Copy, AlertTriangle, Check, X } from "lucide-react";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

interface PartialDeleteDialogProps {
  open: boolean;
  path: string;
  message?: string;
  leftoverCount?: number;
  onClose: () => void;
}

export function PartialDeleteDialog({
  open,
  path,
  message,
  leftoverCount = 0,
  onClose,
}: PartialDeleteDialogProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { injectFonts(); }, []);

  // Reset copied state when reopened
  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Best-effort fallback
      const textarea = document.createElement("textarea");
      textarea.value = path;
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand("copy"); setCopied(true); } catch {}
      document.body.removeChild(textarea);
      setTimeout(() => setCopied(false), 2200);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100001,
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONTS.sans,
      }}
    >
      <div
        style={{
          width: 600,
          maxWidth: "92vw",
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: 32,
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.7)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Warning glow */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -120,
            right: -120,
            width: 320,
            height: 320,
            background: `radial-gradient(circle, ${C.warn}10 0%, transparent 70%)`,
            pointerEvents: "none",
          }}
        />

        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            background: "transparent",
            border: "none",
            color: C.textDim,
            cursor: "pointer",
            padding: 6,
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.color = C.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textDim; }}
        >
          <X size={14} />
        </button>

        <div style={{ position: "relative" }}>
          {/* Editorial label */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <AlertTriangle size={14} style={{ color: C.warn }} />
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 9,
                fontWeight: 500,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: C.warn,
              }}
            >
              / FS
            </span>
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 9,
                fontWeight: 500,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: C.textDim,
              }}
            >
              Partial Delete
            </span>
          </div>

          {/* Display heading */}
          <h3
            style={{
              fontFamily: FONTS.display,
              fontSize: 32,
              fontWeight: 400,
              lineHeight: 1.05,
              color: C.text,
              margin: "0 0 14px 0",
            }}
          >
            folder is{" "}
            <span style={{ fontStyle: "italic", color: C.warn }}>locked</span>
            <span style={{ color: C.warn }}>.</span>
          </h3>

          {/* Body */}
          <p
            style={{
              fontSize: 13,
              color: C.textMid,
              lineHeight: 1.6,
              margin: "0 0 18px 0",
              maxWidth: 480,
            }}
          >
            {message ||
              "The project folder couldn't be removed because it's held open by another process. The folder has been emptied — close PiPilot IDE and delete the empty folder manually."}
          </p>

          {/* Steps list */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              margin: "0 0 20px 0",
              padding: "14px 16px",
              background: C.surfaceAlt,
              border: `1px solid ${C.border}`,
              borderRadius: 5,
            }}
          >
            <Step n="01" text="Close PiPilot IDE entirely" />
            <Step n="02" text="Open File Explorer / Terminal at the path below" />
            <Step n="03" text="Delete the empty folder manually" />
          </div>

          {/* Path with copy button */}
          <div style={{ marginBottom: 8 }}>
            <span
              style={{
                fontFamily: FONTS.mono,
                fontSize: 9,
                fontWeight: 500,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: C.textDim,
              }}
            >
              // PATH
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              gap: 0,
              border: `1px solid ${C.border}`,
              borderRadius: 5,
              overflow: "hidden",
              background: C.bg,
            }}
          >
            <div
              style={{
                flex: 1,
                padding: "10px 14px",
                fontFamily: FONTS.mono,
                fontSize: 11,
                color: C.text,
                overflowX: "auto",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
              title={path}
            >
              {path}
            </div>
            <button
              onClick={handleCopy}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 16px",
                background: copied ? C.accent : "transparent",
                color: copied ? C.bg : C.textMid,
                border: "none",
                borderLeft: `1px solid ${C.border}`,
                fontFamily: FONTS.mono,
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                cursor: "pointer",
                transition: "all 0.15s",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                if (!copied) {
                  e.currentTarget.style.background = C.accentDim;
                  e.currentTarget.style.color = C.accent;
                }
              }}
              onMouseLeave={(e) => {
                if (!copied) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = C.textMid;
                }
              }}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          {leftoverCount > 0 && (
            <p
              style={{
                marginTop: 12,
                fontSize: 11,
                fontFamily: FONTS.mono,
                color: C.warn,
              }}
            >
              // {leftoverCount} file{leftoverCount === 1 ? "" : "s"} couldn't be
              removed inside the locked folder
            </p>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 24,
            }}
          >
            <button
              onClick={onClose}
              style={{
                padding: "10px 22px",
                fontFamily: FONTS.mono,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                background: C.accent,
                color: C.bg,
                border: `1px solid ${C.accent}`,
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: 9,
          color: C.warn,
          flexShrink: 0,
          minWidth: 18,
        }}
      >
        {n}
      </span>
      <span
        style={{
          fontFamily: FONTS.sans,
          fontSize: 12,
          color: C.text,
          lineHeight: 1.5,
        }}
      >
        {text}
      </span>
    </div>
  );
}
