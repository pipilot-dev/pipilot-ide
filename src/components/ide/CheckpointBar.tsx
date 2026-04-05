import { useState, useRef, useEffect } from "react";
import { Undo2, Redo2, History } from "lucide-react";
import { useCheckpoints } from "@/hooks/useCheckpoints";

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function CheckpointBar() {
  const {
    checkpoints,
    currentIndex,
    undo,
    redo,
    restoreToCheckpoint,
    canUndo,
    canRedo,
  } = useCheckpoints();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  return (
    <div
      className="flex items-center gap-0.5 px-1"
      style={{ height: "100%" }}
    >
      {/* Undo */}
      <button
        onClick={undo}
        disabled={!canUndo}
        title="Undo (restore previous checkpoint)"
        className="flex items-center justify-center rounded p-1 transition-colors"
        style={{
          color: canUndo ? "hsl(220 14% 75%)" : "hsl(220 14% 35%)",
          cursor: canUndo ? "pointer" : "default",
          background: "transparent",
          border: "none",
        }}
        onMouseEnter={(e) => {
          if (canUndo)
            (e.currentTarget as HTMLElement).style.background =
              "hsl(220 13% 25%)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        <Undo2 size={14} />
      </button>

      {/* Redo */}
      <button
        onClick={redo}
        disabled={!canRedo}
        title="Redo (restore next checkpoint)"
        className="flex items-center justify-center rounded p-1 transition-colors"
        style={{
          color: canRedo ? "hsl(220 14% 75%)" : "hsl(220 14% 35%)",
          cursor: canRedo ? "pointer" : "default",
          background: "transparent",
          border: "none",
        }}
        onMouseEnter={(e) => {
          if (canRedo)
            (e.currentTarget as HTMLElement).style.background =
              "hsl(220 13% 25%)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        <Redo2 size={14} />
      </button>

      {/* History dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen((p) => !p)}
          title="Checkpoint history"
          className="flex items-center gap-1 rounded p-1 transition-colors"
          style={{
            color: "hsl(220 14% 70%)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background =
              "hsl(220 13% 25%)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <History size={14} />
          {checkpoints.length > 0 && (
            <span
              className="flex items-center justify-center rounded-full text-xs font-medium"
              style={{
                minWidth: 16,
                height: 16,
                padding: "0 4px",
                background: "hsl(220 13% 28%)",
                color: "hsl(220 14% 70%)",
                fontSize: 10,
              }}
            >
              {checkpoints.length}
            </span>
          )}
        </button>

        {dropdownOpen && (
          <div
            className="absolute right-0 z-50 mb-1 overflow-hidden rounded-md border shadow-lg"
            style={{
              bottom: "100%",
              minWidth: 280,
              maxHeight: 400,
              overflowY: "auto",
              background: "hsl(220 13% 16%)",
              borderColor: "hsl(220 13% 25%)",
            }}
          >
            {checkpoints.length === 0 ? (
              <div
                className="px-3 py-4 text-center text-xs"
                style={{ color: "hsl(220 14% 50%)" }}
              >
                No checkpoints yet
              </div>
            ) : (
              <div className="py-1">
                {checkpoints.map((cp, idx) => (
                  <button
                    key={cp.id}
                    onClick={() => {
                      restoreToCheckpoint(cp.id);
                      setDropdownOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors"
                    style={{
                      background:
                        idx === currentIndex
                          ? "hsl(220 13% 22%)"
                          : "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "hsl(220 14% 80%)",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "hsl(220 13% 24%)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        idx === currentIndex
                          ? "hsl(220 13% 22%)"
                          : "transparent";
                    }}
                  >
                    <div
                      className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                      style={{
                        background:
                          idx === currentIndex
                            ? "hsl(210 100% 60%)"
                            : "hsl(220 14% 40%)",
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className="truncate text-xs font-medium"
                        style={{ color: "hsl(220 14% 82%)" }}
                      >
                        {cp.label}
                      </div>
                    </div>
                    <span
                      className="flex-shrink-0 text-xs"
                      style={{ color: "hsl(220 14% 45%)", fontSize: 10 }}
                    >
                      {formatRelativeTime(cp.createdAt)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
