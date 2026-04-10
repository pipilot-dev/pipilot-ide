import { useState, useEffect } from "react";
import { ListOrdered, Clock, X } from "lucide-react";

interface QueuePanelProps {
  projectId: string;
  isStreaming: boolean;
}

export function QueuePanel({ projectId, isStreaming }: QueuePanelProps) {
  const [queue, setQueue] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(true);

  // Poll queue status every 3 seconds while streaming
  useEffect(() => {
    if (!isStreaming || !projectId) return;

    async function checkQueue() {
      try {
        const res = await fetch(`/api/agent/queue?projectId=${encodeURIComponent(projectId)}`);
        if (res.ok) {
          const data = await res.json();
          setQueue(data.queue || []);
        }
      } catch {}
    }

    checkQueue();
    const interval = setInterval(checkQueue, 3000);
    return () => clearInterval(interval);
  }, [projectId, isStreaming]);

  // Clear when not streaming
  useEffect(() => {
    if (!isStreaming) setQueue([]);
  }, [isStreaming]);

  if (queue.length === 0) return null;

  return (
    <div style={{ borderTop: "1px solid hsl(220 13% 22%)", background: "hsl(220 13% 13%)" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "5px 12px", border: "none", background: "transparent",
          cursor: "pointer", color: "hsl(220 14% 70%)", fontSize: 11,
        }}
      >
        <ListOrdered size={12} style={{ color: "hsl(38 92% 50%)" }} />
        <span style={{ fontWeight: 600 }}>Queue</span>
        <span style={{ color: "hsl(38 92% 50%)", fontSize: 10 }}>
          {queue.length} pending
        </span>
      </button>

      {expanded && (
        <div style={{ padding: "0 12px 6px" }}>
          {queue.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "3px 0", fontSize: 10, color: "hsl(220 14% 55%)",
              }}
            >
              <Clock size={10} style={{ flexShrink: 0, color: "hsl(38 92% 50%)" }} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {msg.length > 60 ? msg.slice(0, 60) + "..." : msg}
              </span>
              <span style={{ color: "hsl(220 14% 35%)", flexShrink: 0 }}>#{i + 1}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
