import { useState } from "react";
import { ChevronDown, ChevronUp, CheckCircle2, Loader2, Circle, ListTodo } from "lucide-react";

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

  if (todos.length === 0) return null;

  const completed = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.filter((t) => t.status === "in_progress").length;
  const total = todos.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div
      style={{
        borderTop: "1px solid hsl(220 13% 22%)",
        background: "hsl(220 13% 14%)",
      }}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "hsl(220 14% 75%)",
          fontSize: 11,
        }}
      >
        <ListTodo size={13} style={{ color: "hsl(207 90% 60%)", flexShrink: 0 }} />
        <span style={{ fontWeight: 600 }}>Tasks</span>
        <span style={{ color: "hsl(220 14% 45%)" }}>
          {completed}/{total}
        </span>

        {/* Progress bar */}
        <div
          style={{
            flex: 1,
            height: 3,
            background: "hsl(220 13% 22%)",
            borderRadius: 2,
            overflow: "hidden",
            marginLeft: 4,
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background: progress === 100 ? "hsl(142 71% 45%)" : "hsl(207 90% 54%)",
              borderRadius: 2,
              transition: "width 300ms ease",
            }}
          />
        </div>

        {inProgress > 0 && (
          <span style={{ fontSize: 10, color: "hsl(38 92% 50%)" }}>
            {inProgress} active
          </span>
        )}

        {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>

      {/* Todo list — collapsible */}
      {expanded && (
        <div style={{ padding: "0 12px 8px", maxHeight: 160, overflowY: "auto" }}>
          {todos.map((todo, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
                padding: "3px 0",
                fontSize: 11,
                opacity: todo.status === "completed" ? 0.6 : 1,
              }}
            >
              {/* Status icon */}
              {todo.status === "completed" ? (
                <CheckCircle2 size={13} style={{ color: "hsl(142 71% 45%)", flexShrink: 0, marginTop: 1 }} />
              ) : todo.status === "in_progress" ? (
                <Loader2 size={13} style={{ color: "hsl(207 90% 60%)", flexShrink: 0, marginTop: 1, animation: "spin 1s linear infinite" }} />
              ) : (
                <Circle size={13} style={{ color: "hsl(220 14% 40%)", flexShrink: 0, marginTop: 1 }} />
              )}

              {/* Text */}
              <span
                style={{
                  color: todo.status === "in_progress"
                    ? "hsl(207 90% 75%)"
                    : todo.status === "completed"
                    ? "hsl(220 14% 50%)"
                    : "hsl(220 14% 65%)",
                  textDecoration: todo.status === "completed" ? "line-through" : "none",
                  lineHeight: 1.4,
                }}
              >
                {todo.status === "in_progress" && todo.activeForm
                  ? todo.activeForm
                  : todo.content}
              </span>
            </div>
          ))}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
