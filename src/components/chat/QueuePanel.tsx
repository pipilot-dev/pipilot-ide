/**
 * QueuePanel — editorial-terminal styled view of the local message queue.
 * Mirrors TodoPanel's look so they sit together as a coherent stack
 * above the chat input.
 *
 * The queue is owned by useAgentChat (localStorage-backed) and passed in
 * as a controlled list — no more polling the disabled server-side queue.
 */

import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, X, Send } from "lucide-react";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

interface QueuePanelProps {
  queue?: string[];
  onRemove?: (index: number) => void;
  onClear?: () => void;
}

export function QueuePanel({ queue, onRemove, onClear }: QueuePanelProps) {
  const [expanded, setExpanded] = useState(true);
  useEffect(() => { injectFonts(); }, []);

  // Defensive: callers may pass undefined during HMR/initial load
  const safeQueue = queue ?? [];
  const safeRemove = onRemove ?? (() => {});
  const safeClear = onClear ?? (() => {});

  if (safeQueue.length === 0) return null;

  return (
    <div
      style={{
        borderTop: `1px solid ${C.border}`,
        background: C.surface,
        fontFamily: FONTS.sans,
      }}
    >
      {/* ── Header ── */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: C.text,
          textAlign: "left",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: C.accent,
            boxShadow: `0 0 8px ${C.accent}80`,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: C.accent,
            flexShrink: 0,
          }}
        >
          / Q
        </span>
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: C.text,
            flexShrink: 0,
          }}
        >
          Queued
        </span>
        <span
          style={{
            fontFamily: FONTS.mono,
            fontSize: 9,
            color: C.textDim,
            letterSpacing: "0.05em",
            flexShrink: 0,
          }}
        >
          ({String(safeQueue.length).padStart(2, "0")})
        </span>

        <div style={{ flex: 1 }} />

        <span
          onClick={(e) => {
            e.stopPropagation();
            safeClear();
          }}
          style={{
            fontFamily: FONTS.mono,
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: C.textDim,
            padding: "2px 8px",
            borderRadius: 2,
            cursor: "pointer",
            transition: "color 0.15s",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.color = "#ff9b9b";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.color = C.textDim;
          }}
        >
          clear
        </span>

        {expanded ? (
          <ChevronDown size={11} style={{ color: C.textDim, flexShrink: 0 }} />
        ) : (
          <ChevronRight size={11} style={{ color: C.textDim, flexShrink: 0 }} />
        )}
      </button>

      {/* ── Queue list ── */}
      {expanded && (
        <div
          style={{
            padding: "0 0 8px",
            maxHeight: 200,
            overflowY: "auto",
            borderTop: `1px solid ${C.border}`,
          }}
        >
          {safeQueue.map((item, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "7px 16px 7px 18px",
                borderLeft: `2px solid ${i === 0 ? C.accent : C.accentLine}`,
                borderBottom: i === safeQueue.length - 1 ? "none" : `1px solid ${C.border}`,
                background: i === 0 ? C.accentDim : "transparent",
                transition: "background 0.15s",
              }}
            >
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 9,
                  color: i === 0 ? C.accent : C.textFaint,
                  flexShrink: 0,
                  marginTop: 3,
                  minWidth: 16,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>

              <span style={{ flexShrink: 0, marginTop: 1 }}>
                <Send
                  size={11}
                  style={{ color: i === 0 ? C.accent : C.textDim }}
                />
              </span>

              <span
                style={{
                  flex: 1,
                  fontFamily: FONTS.sans,
                  fontSize: 12,
                  color: i === 0 ? C.text : C.textMid,
                  lineHeight: 1.5,
                  minWidth: 0,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  textOverflow: "ellipsis",
                }}
              >
                {item}
              </span>

              <button
                onClick={() => safeRemove(i)}
                title="Remove from queue"
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
                  marginTop: 1,
                  opacity: 0.5,
                  transition: "opacity 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "1";
                  e.currentTarget.style.color = "#ff9b9b";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "0.5";
                  e.currentTarget.style.color = C.textDim;
                }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
