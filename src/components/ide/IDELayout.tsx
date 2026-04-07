import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { ActivityBar, ActivityBarView } from "./ActivityBar";
import { SidebarPanel } from "./SidebarPanel";
import { EditorArea, EditorTab } from "./EditorArea";
import { ChatPanel } from "../chat/ChatPanel";
import { CommandPalette } from "./CommandPalette";
import { TerminalPanel } from "./TerminalPanel";
import { CheckpointBar } from "./CheckpointBar";
import SettingsPanel from "@/components/ide/SettingsPanel";
import { useFileSystem, FileNode } from "@/hooks/useFileSystem";
import { useCheckpoints } from "@/hooks/useCheckpoints";
import { useSidebarResizable, useResizable } from "@/hooks/useResizable";
import { WorkspaceContext, CheckpointManager } from "@/hooks/useChat";
import { db } from "@/lib/db";
import {
  GitBranch,
  AlertCircle,
  CheckCircle2,
  Wifi,
  Terminal,
  ChevronUp,
  ChevronDown,
  Globe,
  Rocket,
  ExternalLink,
  Loader2,
  HelpCircle,
} from "lucide-react";
import { deploySite, DeployResult } from "@/lib/deploy";
import { useProjects } from "@/hooks/useProjects";
import { HelpDialog } from "@/components/ide/HelpDialog";
import { NotificationCenter } from "@/components/ide/NotificationCenter";
import { ProblemsPanel } from "@/components/ide/ProblemsPanel";
import { useNotifications } from "@/contexts/NotificationContext";
import { useProblems } from "@/contexts/ProblemsContext";

function findFileById(nodes: FileNode[], id: string): FileNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findFileById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function IDELayout() {
  const [activeView, setActiveView] = useState<ActivityBarView | null>("explorer");
  const [chatOpen, setChatOpen] = useState(true);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [lastDeploy, setLastDeploy] = useState<DeployResult | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);

  const { addNotification } = useNotifications();
  const { errorCount, warningCount } = useProblems();
  const bellRef = useRef<HTMLElement>(null);

  const sidebar = useSidebarResizable(220, 140, 400);
  const chatPanel = useResizable(360, 260, 600, "horizontal");
  const { activeProject } = useProjects();

  const { files, isReady, executeTool, updateFileContent, changeLog, activeProjectId } = useFileSystem();
  const checkpoints = useCheckpoints();

  // Deploy handler
  const handleDeploy = useCallback(async () => {
    if (deploying || !activeProject) return;
    setDeploying(true);
    try {
      const result = await deploySite(activeProjectId, activeProject.name);
      setLastDeploy(result);
      if (result.success) {
        window.open(result.url, "_blank");
        addNotification({ title: "Site Deployed", message: `Live at: ${result.url}`, type: "success" });
      } else {
        addNotification({ title: "Deploy Failed", message: result.error || "Unknown error", type: "error" });
      }
    } catch (err) {
      setLastDeploy({ success: false, url: "", slug: "", fileCount: 0, error: String(err) });
      addNotification({ title: "Deploy Failed", message: String(err), type: "error" });
    } finally {
      setDeploying(false);
    }
  }, [deploying, activeProject, activeProjectId]);

  // Wrap tool executor to auto-create checkpoints on mutations + deploy tool
  const toolExecutorWithCheckpoints = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<string> => {
      // Handle deploy_site tool
      if (name === "deploy_site") {
        if (!activeProject) return "Error: No active project";
        // AI can pass a custom slug; fall back to project name
        const customSlug = args.slug as string | undefined;
        const result = await deploySite(activeProjectId, customSlug || activeProject.name);
        setLastDeploy(result);
        if (result.success) {
          addNotification({ title: "Site Deployed", message: `Live at: ${result.url}`, type: "success" });
          return `✓ Site deployed! Live at: ${result.url} (${result.fileCount} files)`;
        }
        addNotification({ title: "Deploy Failed", message: result.error || "Unknown error", type: "error" });
        return `Error deploying: ${result.error}`;
      }

      const result = await executeTool(name, args);
      // Create checkpoint after file mutations
      const mutationTools = ["create_file", "edit_file", "delete_file", "rename_file", "copy_file", "batch_create_files"];
      if (mutationTools.includes(name)) {
        const label = name === "create_file"
          ? `Created ${args.path}`
          : name === "edit_file"
            ? `Edited ${args.path}`
            : name === "delete_file"
              ? `Deleted ${args.path}`
              : name === "rename_file"
                ? `Renamed ${args.oldPath} → ${args.newPath}`
                : name === "copy_file"
                  ? `Copied ${args.srcPath} → ${args.destPath}`
                  : `Batch created ${(args.files as unknown[])?.length ?? 0} files`;
        checkpoints.createCheckpoint(label).catch(console.error);
      }
      return result;
    },
    [executeTool, checkpoints, activeProject, activeProjectId]
  );

  // Build checkpoint manager for the chat panel
  const checkpointManagerForChat: CheckpointManager = useMemo(
    () => ({
      createCheckpoint: checkpoints.createCheckpoint,
      restoreToCheckpoint: checkpoints.restoreToCheckpoint,
      findCheckpointBeforeMessage: checkpoints.findCheckpointBeforeMessage,
    }),
    [checkpoints.createCheckpoint, checkpoints.restoreToCheckpoint, checkpoints.findCheckpointBeforeMessage]
  );

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

  const handleOpenPreview = useCallback(() => {
    const previewId = "__preview__";
    setTabs((prev) => {
      const exists = prev.find((t) => t.node.id === previewId);
      if (exists) {
        setActiveTabId(previewId);
        return prev;
      }
      setActiveTabId(previewId);
      return [
        ...prev,
        {
          node: { id: previewId, name: "Web Preview", type: "file" as const },
          isDirty: false,
          isPreview: true,
        },
      ];
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

  // When files change from AI edits, update open tabs
  // Use changeLog length as the trigger instead of files (which gets a new ref every render)
  const changeCount = changeLog.length;
  useEffect(() => {
    if (!changeCount || !files.length) return;
    setTabs((prev) => {
      let changed = false;
      const next = prev.map((tab) => {
        const updated = findFileById(files, tab.node.id);
        if (updated && updated.content !== tab.node.content) {
          changed = true;
          return { ...tab, node: { ...tab.node, content: updated.content } };
        }
        return tab;
      });
      return changed ? next : prev;
    });
  }, [changeCount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle editor content changes - save to IndexedDB
  const handleEditorChange = useCallback(
    (fileId: string, content: string) => {
      updateFileContent(fileId, content);
      setTabs((prev) =>
        prev.map((tab) =>
          tab.node.id === fileId
            ? { ...tab, node: { ...tab.node, content }, isDirty: true }
            : tab
        )
      );
    },
    [updateFileContent]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Shift+I - toggle chat
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "I") {
        e.preventDefault();
        setChatOpen((p) => !p);
      }
      // Ctrl+P - command palette
      if ((e.ctrlKey || e.metaKey) && e.key === "p") {
        e.preventDefault();
        setCommandPaletteOpen((p) => !p);
      }
      // Ctrl+` - toggle terminal
      if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setTerminalOpen((p) => !p);
      }
      // Ctrl+, - toggle settings
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen((p) => !p);
      }
      // Ctrl+Shift+/ - toggle help
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "/") {
        e.preventDefault();
        setHelpOpen((p) => !p);
      }
      // Ctrl+B - toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        setActiveView((prev) => (prev ? null : "explorer"));
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const activeFile = activeTabId
    ? findFileById(
        tabs.map((t) => t.node),
        activeTabId
      )
    : null;

  // Flatten files for command palette
  const flattenFiles = (nodes: FileNode[]): FileNode[] => {
    const result: FileNode[] = [];
    for (const node of nodes) {
      if (node.type === "file") result.push(node);
      if (node.children) result.push(...flattenFiles(node.children));
    }
    return result;
  };

  // Build workspace context for the AI system prompt
  const workspaceContext = useMemo((): WorkspaceContext | undefined => {
    if (!files.length) return undefined;

    // Build indented file tree string
    function renderTree(nodes: FileNode[], indent: string = ""): string {
      let result = "";
      const sorted = [...nodes].sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (let i = 0; i < sorted.length; i++) {
        const node = sorted[i];
        const isLast = i === sorted.length - 1;
        const prefix = indent + (isLast ? "└── " : "├── ");
        const childIndent = indent + (isLast ? "    " : "│   ");
        const suffix = node.type === "folder" ? "/" : "";
        const lineInfo = node.type === "file" && node.content
          ? ` (${node.content.split("\n").length} lines)`
          : "";
        result += prefix + node.name + suffix + lineInfo + "\n";
        if (node.children && node.children.length > 0) {
          result += renderTree(node.children, childIndent);
        }
      }
      return result;
    }

    const fileTree = renderTree(files).trimEnd();

    // Detect project type from files
    const allFlat = flattenFiles(files);
    const fileNames = allFlat.map((f) => f.name.toLowerCase());
    const hasFile = (name: string) => fileNames.includes(name.toLowerCase());

    const techs: string[] = [];
    if (allFlat.some((f) => f.name.endsWith(".html"))) techs.push("HTML");
    if (allFlat.some((f) => f.name.endsWith(".css"))) techs.push("CSS");
    if (allFlat.some((f) => f.name.endsWith(".js"))) techs.push("JavaScript");
    if (allFlat.some((f) => f.content?.includes("tailwind"))) techs.push("Tailwind CSS");

    return {
      fileTree,
      projectType: (activeProject?.type === "cloud" ? "Node.js (E2B Cloud — full npm/Vite/Next.js/SSR) + " : activeProject?.type === "nodebox" ? "Node.js (Nodebox) + " : "") + (techs.length > 0 ? techs.join(" + ") : "HTML + CSS + JavaScript"),
      dependencies: "Tailwind CSS (CDN)",
    };
  }, [files]);

  if (!isReady) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: "100vh", width: "100vw", background: "hsl(220 13% 18%)" }}
      >
        <div className="text-center" style={{ color: "hsl(220 14% 60%)" }}>
          <div className="text-lg mb-2">Loading workspace...</div>
          <div className="text-xs opacity-50">Initializing IndexedDB</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: "100vh", width: "100vw", overflow: "hidden" }}>
      {/* Command Palette */}
      {commandPaletteOpen && (
        <CommandPalette
          files={flattenFiles(files)}
          onSelectFile={(node) => {
            handleSelectFile(node);
            setCommandPaletteOpen(false);
          }}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Activity bar */}
        <ActivityBar
          activeView={activeView}
          onViewChange={handleViewChange}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((p) => !p)}
          onOpenSettings={() => setSettingsOpen(true)}
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
                files={files}
                onRunPreview={handleOpenPreview}
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

        {/* Editor + Terminal area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <EditorArea
            tabs={tabs}
            activeTabId={activeTabId}
            onActivateTab={setActiveTabId}
            onCloseTab={handleCloseTab}
            onContentChange={handleEditorChange}
            allFiles={files}
            onSelectFile={handleSelectFile}
            onOpenPreview={handleOpenPreview}
            projectType={activeProject?.type || "static"}
          />

          {/* Problems panel */}
          {problemsOpen && <ProblemsPanel onClose={() => setProblemsOpen(false)} />}

          {/* Terminal panel */}
          {terminalOpen && (
            <>
              <div
                className="flex items-center justify-between px-3 border-t border-b"
                style={{
                  height: 30,
                  minHeight: 30,
                  background: "hsl(220 13% 16%)",
                  borderColor: "hsl(220 13% 22%)",
                }}
              >
                <div className="flex items-center gap-2">
                  <Terminal size={12} style={{ color: "hsl(220 14% 60%)" }} />
                  <span className="text-xs font-medium" style={{ color: "hsl(220 14% 70%)" }}>
                    Terminal
                  </span>
                </div>
                <button
                  onClick={() => setTerminalOpen(false)}
                  className="p-0.5 rounded hover:bg-accent transition-colors"
                  style={{ color: "hsl(220 14% 55%)" }}
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              <TerminalPanel />
            </>
          )}
        </div>

        {/* Chat panel */}
        {chatOpen && (
          <>
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
              <ChatPanel toolExecutor={toolExecutorWithCheckpoints} workspaceContext={workspaceContext} checkpointManager={checkpointManagerForChat} projectId={activeProjectId} fileTree={files} />
            </div>
          </>
        )}
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Status bar */}
      <div className="status-bar" data-testid="status-bar">
        <div className="flex items-center gap-1.5">
          <GitBranch size={11} />
          <span>main</span>
        </div>
        <button
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
          onClick={() => setProblemsOpen((p) => !p)}
        >
          {errorCount > 0 ? <AlertCircle size={13} style={{ color: "hsl(0 84% 60%)" }} /> : <CheckCircle2 size={11} style={{ color: "hsl(142 71% 60%)" }} />}
          <span>{errorCount > 0 || warningCount > 0 ? `${errorCount} errors, ${warningCount} warnings` : "No Problems"}</span>
        </button>
        <button
          className="flex items-center gap-1 hover:opacity-80 transition-opacity"
          onClick={() => setTerminalOpen((p) => !p)}
        >
          <Terminal size={11} />
          <span>Terminal</span>
        </button>
        <button
          className="flex items-center gap-1 hover:opacity-80 transition-opacity"
          onClick={handleOpenPreview}
        >
          <Globe size={11} />
          <span>Preview</span>
        </button>
        <button
          className="flex items-center gap-1 hover:opacity-80 transition-opacity"
          onClick={handleDeploy}
          disabled={deploying}
          style={lastDeploy?.success ? { color: "hsl(142 71% 60%)" } : undefined}
        >
          {deploying ? <Loader2 size={11} className="animate-spin" /> : <Rocket size={11} />}
          <span>{deploying ? "Deploying..." : "Deploy"}</span>
        </button>
        {lastDeploy?.success && (
          <a
            href={lastDeploy.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:opacity-80 transition-opacity"
            style={{ color: "hsl(207 90% 60%)" }}
          >
            <ExternalLink size={10} />
            <span className="text-xs truncate" style={{ maxWidth: 120 }}>{lastDeploy.slug}</span>
          </a>
        )}
        <CheckpointBar />
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
        <NotificationCenter anchorRef={bellRef} />
        <button
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
          onClick={() => setHelpOpen(true)}
        >
          <HelpCircle size={13} />
          <span>Help</span>
        </button>
      </div>
    </div>
  );
}
