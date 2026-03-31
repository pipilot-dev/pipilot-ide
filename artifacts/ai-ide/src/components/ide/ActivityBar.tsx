import {
  Files,
  Search,
  GitBranch,
  Package,
  Settings,
  MessageSquareCode,
  Bug,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type ActivityBarView = "explorer" | "search" | "source-control" | "extensions" | "debug";

interface ActivityBarProps {
  activeView: ActivityBarView | null;
  onViewChange: (view: ActivityBarView) => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}

const ACTIVITIES: { id: ActivityBarView; icon: React.ReactNode; label: string }[] = [
  { id: "explorer", icon: <Files size={22} />, label: "Explorer" },
  { id: "search", icon: <Search size={22} />, label: "Search" },
  { id: "source-control", icon: <GitBranch size={22} />, label: "Source Control" },
  { id: "debug", icon: <Bug size={22} />, label: "Run and Debug" },
  { id: "extensions", icon: <Package size={22} />, label: "Extensions" },
];

export function ActivityBar({ activeView, onViewChange, chatOpen, onToggleChat }: ActivityBarProps) {
  return (
    <div className="activity-bar" data-testid="activity-bar">
      {ACTIVITIES.map((item) => (
        <Tooltip key={item.id} delayDuration={400}>
          <TooltipTrigger asChild>
            <button
              className={`activity-bar-btn ${activeView === item.id ? "active" : ""}`}
              onClick={() => onViewChange(item.id)}
              data-testid={`activity-btn-${item.id}`}
            >
              {item.icon}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      ))}

      <div className="flex-1" />

      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>
          <button
            className={`activity-bar-btn ${chatOpen ? "active" : ""}`}
            onClick={onToggleChat}
            data-testid="activity-btn-chat"
            style={{ marginBottom: 8 }}
          >
            <MessageSquareCode size={22} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">AI Chat (Ctrl+Shift+I)</TooltipContent>
      </Tooltip>

      <Tooltip delayDuration={400}>
        <TooltipTrigger asChild>
          <button className="activity-bar-btn" data-testid="activity-btn-settings" style={{ marginBottom: 8 }}>
            <Settings size={22} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Settings</TooltipContent>
      </Tooltip>
    </div>
  );
}
