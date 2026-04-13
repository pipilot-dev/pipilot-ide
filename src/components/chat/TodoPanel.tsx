/**
 * TodoPanel — editorial-terminal styled task tracker for the agent's TodoWrite tool.
 */

import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, Loader2, Circle } from "lucide-react";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

export interface TodoItem {
  content: string;
  activeForm?: string;
  status: "pending" | "in_progress" | "completed";
}

interface TodoPanelProps {
  todos: TodoItem[];
}

export function TodoPanel({ todos }: TodoPanelProps) {
  const [expanded, setExpanded] = useState(true);
  useEffect(() => { injectFonts(); }, []);

  if (todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.filter((t) => t.status === "in_progress").length;
  const total = todos.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

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
        {/* Editorial label cluster */}
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: progress === 100 ? C.accent : inProgress > 0 ? C.warn : C.textDim,
            boxShadow:
              progress === 100
                ? `0 0 8px ${C.accent}80`
                : inProgress > 0
                ? `0 0 8px ${C.warn}80`
                : "none",
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
          / T
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
          Tasks
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
          ({String(completed).padStart(2, "0")}/{String(total).padStart(2, "0")})
        </span>

        {/* Progress bar */}
        <div
          style={{
            flex: 1,
            height: 2,
            background: C.border,
            borderRadius: 1,
            overflow: "hidden",
            marginLeft: 4,
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background: progress === 100 ? C.accent : C.accentLine,
              transition: "width 300ms ease",
            }}
          />
        </div>

        {inProgress > 0 && (
          <span
            style={{
              fontFamily: FONTS.mono,
              fontSize: 9,
              fontWeight: 500,
              letterSpacing: "0.05em",
              color: C.warn,
              flexShrink: 0,
            }}
          >
            {inProgress} active
          </span>
        )}

        {expanded ? (
          <ChevronDown size={11} style={{ color: C.textDim, flexShrink: 0 }} />
        ) : (
          <ChevronRight size={11} style={{ color: C.textDim, flexShrink: 0 }} />
        )}
      </button>

      {/* ── Todo list ── */}
      {expanded && (
        <div
          style={{
            padding: "0 0 8px",
            maxHeight: 200,
            overflowY: "auto",
            borderTop: `1px solid ${C.border}`,
          }}
        >
          {todos.map((todo, i) => {
            const isInProgress = todo.status === "in_progress";
            const isComplete = todo.status === "completed";
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "7px 16px 7px 18px",
                  borderLeft: `2px solid ${
                    isInProgress ? C.accent : isComplete ? C.accentLine : "transparent"
                  }`,
                  borderBottom: i === todos.length - 1 ? "none" : `1px solid ${C.border}`,
                  background: isInProgress ? C.accentDim : "transparent",
                  opacity: isComplete ? 0.55 : 1,
                  transition: "background 0.15s",
                }}
              >
                {/* Index */}
                <span
                  style={{
                    fontFamily: FONTS.mono,
                    fontSize: 9,
                    color: isInProgress ? C.accent : C.textFaint,
                    flexShrink: 0,
                    marginTop: 3,
                    minWidth: 16,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>

                {/* Status icon */}
                <span style={{ flexShrink: 0, marginTop: 1 }}>
                  {isComplete ? (
                    <CheckCircle2 size={12} style={{ color: C.accent }} />
                  ) : isInProgress ? (
                    <Loader2
                      size={12}
                      style={{
                        color: C.accent,
                        animation: "pipilot-spin 1s linear infinite",
                      }}
                    />
                  ) : (
                    <Circle size={12} style={{ color: C.textDim }} />
                  )}
                </span>

                {/* Text */}
                <span
                  style={{
                    flex: 1,
                    fontFamily: FONTS.sans,
                    fontSize: 12,
                    color: isInProgress
                      ? C.text
                      : isComplete
                      ? C.textDim
                      : C.textMid,
                    textDecoration: isComplete ? "line-through" : "none",
                    lineHeight: 1.5,
                    minWidth: 0,
                  }}
                >
                  {isInProgress && todo.activeForm ? todo.activeForm : todo.content}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes pipilot-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
