import {
  Files,
  Search,
  GitBranch,
  Package,
  Settings,
  MessageSquareCode,
  Bug,
} from "lucide-react";

export type ActivityBarView = "explorer" | "search" | "source-control" | "extensions" | "debug";

interface ActivityBarProps {
  activeView: ActivityBarView | null;
  onViewChange: (view: ActivityBarView) => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  onOpenSettings?: () => void;
  badges?: Partial<Record<ActivityBarView, number>>;
}

const ACTIVITIES: { id: ActivityBarView; icon: React.ReactNode; label: string }[] = [
  { id: "explorer", icon: <Files size={22} />, label: "Explorer" },
  { id: "search", icon: <Search size={22} />, label: "Search" },
  { id: "source-control", icon: <GitBranch size={22} />, label: "Source Control" },
  { id: "debug", icon: <Bug size={22} />, label: "Run and Debug" },
  { id: "extensions", icon: <Package size={22} />, label: "Extensions" },
];

export function ActivityBar({ activeView, onViewChange, chatOpen, onToggleChat, onOpenSettings, badges }: ActivityBarProps) {
  return (
    <div className="activity-bar" data-testid="activity-bar">
      {ACTIVITIES.map((item) => {
        const count = badges?.[item.id] ?? 0;
        return (
          <button
            key={item.id}
            className={`activity-bar-btn ${activeView === item.id ? "active" : ""}`}
            onClick={() => onViewChange(item.id)}
            title={count > 0 ? `${item.label} (${count})` : item.label}
            data-testid={`activity-btn-${item.id}`}
            style={{ position: "relative" }}
          >
            {item.icon}
            {count > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: 4, right: 4,
                  minWidth: 16, height: 16, padding: "0 4px",
                  borderRadius: 8,
                  background: "hsl(207 90% 50%)",
                  color: "#fff",
                  fontSize: 9, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: "2px solid hsl(220 13% 13%)",
                  lineHeight: 1,
                }}
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
          </button>
        );
      })}

      <div className="flex-1" />

      <button
        className={`activity-bar-btn ${chatOpen ? "active" : ""}`}
        onClick={onToggleChat}
        title="AI Chat (Ctrl+Shift+I)"
        data-testid="activity-btn-chat"
        style={{ marginBottom: 8 }}
      >
        <MessageSquareCode size={22} />
      </button>

      <button
        className="activity-bar-btn"
        title="Settings"
        data-testid="activity-btn-settings"
        style={{ marginBottom: 8 }}
        onClick={() => onOpenSettings?.()}
      >
        <Settings size={22} />
      </button>
    </div>
  );
}
