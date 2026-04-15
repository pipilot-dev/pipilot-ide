import { useState, useEffect } from "react";
import {
  Files,
  Search,
  GitBranch,
  Package,
  Settings,
  MessageSquareCode,
  Bug,
  BookOpen,
  Cloud,
} from "lucide-react";
import { COLORS as C } from "@/lib/design-tokens";

export type ActivityBarView = "explorer" | "search" | "source-control" | "extensions" | "debug" | "wiki" | "cloud";

interface ActivityBarProps {
  activeView: ActivityBarView | null;
  onViewChange: (view: ActivityBarView) => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  onOpenSettings?: () => void;
  badges?: Partial<Record<ActivityBarView, number>>;
}

const ACTIVITIES: { id: ActivityBarView; icon: React.ReactNode; label: string }[] = [
  { id: "explorer", icon: <Files size={18} strokeWidth={1.6} />, label: "Explorer" },
  { id: "search", icon: <Search size={18} strokeWidth={1.6} />, label: "Search" },
  { id: "source-control", icon: <GitBranch size={18} strokeWidth={1.6} />, label: "Source Control" },
  { id: "debug", icon: <Bug size={18} strokeWidth={1.6} />, label: "Run and Debug" },
  { id: "extensions", icon: <Package size={18} strokeWidth={1.6} />, label: "Extensions" },
  { id: "wiki", icon: <BookOpen size={18} strokeWidth={1.6} />, label: "Wiki" },
  { id: "cloud", icon: <Cloud size={18} strokeWidth={1.6} />, label: "Cloud" },
];

export function ActivityBar({
  activeView, onViewChange, chatOpen, onToggleChat, onOpenSettings, badges,
}: ActivityBarProps) {
  const [showBadges, setShowBadges] = useState(
    () => typeof window !== "undefined"
      ? localStorage.getItem("pipilot:showActivityBadges") !== "false"
      : true
  );

  useEffect(() => {
    function onSettingChanged(e: Event) {
      const { key, value } = (e as CustomEvent<{ key: string; value: string }>).detail ?? {};
      if (key === "showActivityBadges") {
        setShowBadges(value !== "false");
      }
    }
    window.addEventListener("pipilot:setting-changed", onSettingChanged);
    return () => window.removeEventListener("pipilot:setting-changed", onSettingChanged);
  }, []);

  return (
    <div
      data-testid="activity-bar"
      style={{
        width: 48,
        background: C.bg,
        borderRight: `1px solid ${C.border}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 8,
        flexShrink: 0,
        position: "relative",
      }}
    >
      {ACTIVITIES.map((item) => {
        const count = showBadges ? (badges?.[item.id] ?? 0) : 0;
        const isActive = activeView === item.id;
        return (
          <ActivityButton
            key={item.id}
            isActive={isActive}
            label={count > 0 ? `${item.label} (${count})` : item.label}
            onClick={() => onViewChange(item.id)}
            badge={count}
            testid={`activity-btn-${item.id}`}
          >
            {item.icon}
          </ActivityButton>
        );
      })}

      <div style={{ flex: 1 }} />

      <ActivityButton
        isActive={chatOpen}
        label="AI Chat (Ctrl+Shift+I)"
        onClick={onToggleChat}
        testid="activity-btn-chat"
      >
        <MessageSquareCode size={18} strokeWidth={1.6} />
      </ActivityButton>

      <ActivityButton
        isActive={false}
        label="Settings"
        onClick={() => onOpenSettings?.()}
        testid="activity-btn-settings"
      >
        <Settings size={18} strokeWidth={1.6} />
      </ActivityButton>

      <div style={{ height: 12 }} />
    </div>
  );
}

interface ActivityButtonProps {
  isActive: boolean;
  label: string;
  onClick: () => void;
  badge?: number;
  testid?: string;
  children: React.ReactNode;
}

function ActivityButton({ isActive, label, onClick, badge, testid, children }: ActivityButtonProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      data-testid={testid}
      style={{
        position: "relative",
        width: 48,
        height: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: isActive ? C.text : C.textDim,
        transition: "color 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.color = C.textMid;
      }}
      onMouseLeave={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.color = C.textDim;
      }}
    >
      {/* Active indicator — thin lime bar on the left */}
      {isActive && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            width: 2,
            height: 18,
            background: C.accent,
            borderRadius: "0 2px 2px 0",
            boxShadow: `0 0 8px ${C.accent}80`,
          }}
        />
      )}
      {children}
      {badge !== undefined && badge > 0 && (
        <span
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            minWidth: 14,
            height: 14,
            padding: "0 3px",
            borderRadius: 7,
            background: C.accent,
            color: C.bg,
            fontSize: 8,
            fontWeight: 700,
            fontFamily: "JetBrains Mono, monospace",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
            border: `1.5px solid ${C.bg}`,
          }}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}
