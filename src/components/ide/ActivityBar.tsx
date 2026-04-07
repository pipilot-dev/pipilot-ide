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
}

const ACTIVITIES: { id: ActivityBarView; icon: React.ReactNode; label: string }[] = [
  { id: "explorer", icon: <Files size={22} />, label: "Explorer" },
  { id: "search", icon: <Search size={22} />, label: "Search" },
  { id: "source-control", icon: <GitBranch size={22} />, label: "Source Control" },
  { id: "debug", icon: <Bug size={22} />, label: "Run and Debug" },
  { id: "extensions", icon: <Package size={22} />, label: "Extensions" },
];

export function ActivityBar({ activeView, onViewChange, chatOpen, onToggleChat, onOpenSettings }: ActivityBarProps) {
  return (
    <div className="activity-bar" data-testid="activity-bar">
      {ACTIVITIES.map((item) => (
        <button
          key={item.id}
          className={`activity-bar-btn ${activeView === item.id ? "active" : ""}`}
          onClick={() => onViewChange(item.id)}
          title={item.label}
          data-testid={`activity-btn-${item.id}`}
        >
          {item.icon}
        </button>
      ))}

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
