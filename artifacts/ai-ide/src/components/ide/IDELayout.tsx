import { useState, useCallback, useEffect } from "react";
import { ActivityBar, ActivityBarView } from "./ActivityBar";
import { SidebarPanel } from "./SidebarPanel";
import { EditorArea, EditorTab } from "./EditorArea";
import { ChatPanel } from "../chat/ChatPanel";
import { FileNode, findFileById } from "@/data/sampleFiles";
import { useSidebarResizable, useResizable } from "@/hooks/useResizable";
import {
  GitBranch,
  AlertCircle,
  Bell,
  CheckCircle2,
  Wifi,
} from "lucide-react";

export function IDELayout() {
  const [activeView, setActiveView] = useState<ActivityBarView | null>("explorer");
  const [chatOpen, setChatOpen] = useState(false);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const sidebar = useSidebarResizable(220, 140, 400);
  const chatPanel = useResizable(320, 240, 520, "horizontal");

  const handleViewChange = (view: ActivityBarView) => {
    if (activeView === view) {
      setActiveView(null);
    } else {
      setActiveView(view);
    }
  };

  const handleSelectFile = useCallback((node: FileNode) => {
    if (node.type !== "file") return;

    setTabs((prev) => {
      const exists = prev.find((t) => t.node.id === node.id);
      if (exists) {
        setActiveTabId(node.id);
        return prev;
      }
      setActiveTabId(node.id);
      return [...prev, { node, isDirty: false }];
    });
  }, []);

  const handleCloseTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const newTabs = prev.filter((t) => t.node.id !== id);
        if (activeTabId === id) {
          const idx = prev.findIndex((t) => t.node.id === id);
          const next =
            newTabs[Math.min(idx, newTabs.length - 1)]?.node.id ?? null;
          setActiveTabId(next);
        }
        return newTabs;
      });
    },
    [activeTabId]
  );

  // Keyboard shortcut Ctrl+Shift+I to toggle chat
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "I") {
        e.preventDefault();
        setChatOpen((p) => !p);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const activeFile = activeTabId ? findFileById(
    tabs.map((t) => t.node),
    activeTabId
  ) : null;

  return (
    <div className="flex flex-col" style={{ height: "100vh", width: "100vw", overflow: "hidden" }}>
      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Activity bar */}
        <ActivityBar
          activeView={activeView}
          onViewChange={handleViewChange}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((p) => !p)}
        />

        {/* Sidebar */}
        {activeView && (
          <>
            <div
              className="overflow-hidden border-r"
              style={{
                width: sidebar.size,
                minWidth: sidebar.size,
                background: "hsl(220 13% 15%)",
                borderColor: "hsl(220 13% 22%)",
              }}
              data-testid="sidebar"
            >
              <SidebarPanel
                view={activeView}
                selectedFileId={activeTabId}
                onSelectFile={handleSelectFile}
              />
            </div>
            {/* Sidebar resize handle */}
            <div
              className={`resize-handle ${sidebar.isDragging ? "dragging" : ""}`}
              onMouseDown={sidebar.onMouseDown}
              data-testid="sidebar-resize-handle"
            />
          </>
        )}

        {/* Editor area */}
        <EditorArea
          tabs={tabs}
          activeTabId={activeTabId}
          onActivateTab={setActiveTabId}
          onCloseTab={handleCloseTab}
        />

        {/* Chat panel */}
        {chatOpen && (
          <>
            {/* Chat resize handle */}
            <div
              className={`resize-handle ${chatPanel.isDragging ? "dragging" : ""}`}
              onMouseDown={chatPanel.onMouseDown}
              data-testid="chat-resize-handle"
            />
            <div
              className="overflow-hidden border-l"
              style={{
                width: chatPanel.size,
                minWidth: chatPanel.size,
                borderColor: "hsl(220 13% 22%)",
              }}
              data-testid="chat-panel-wrapper"
            >
              <ChatPanel />
            </div>
          </>
        )}
      </div>

      {/* Status bar */}
      <div className="status-bar" data-testid="status-bar">
        <div className="flex items-center gap-1.5">
          <GitBranch size={11} />
          <span>main</span>
        </div>
        <div className="flex items-center gap-1.5">
          <CheckCircle2 size={11} style={{ color: "hsl(142 71% 60%)" }} />
          <span>No Problems</span>
        </div>
        <div className="flex-1" />
        {activeFile && (
          <>
            <span>{activeFile.language?.toUpperCase() ?? "Plain Text"}</span>
            <span>UTF-8</span>
          </>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          <Wifi size={11} />
          <span>Connected</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Bell size={11} />
        </div>
        <div className="flex items-center gap-1.5">
          <AlertCircle size={11} />
          <span>0</span>
        </div>
      </div>
    </div>
  );
}
