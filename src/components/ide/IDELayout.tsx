import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { COLORS as C, FONTS } from "@/lib/design-tokens";
import { ActivityBar, ActivityBarView } from "./ActivityBar";
import { TitleBar } from "./TitleBar";
import { SidebarPanel } from "./SidebarPanel";
import { EditorArea, EditorTab } from "./EditorArea";
import { ChatPanel } from "../chat/ChatPanel";
import { CloudPanel } from "../cloud/CloudPanel";
import { DeploymentPanel } from "../deployment/DeploymentPanel";
import { CommandPalette } from "./CommandPalette";
import { TerminalPanel } from "./TerminalPanel";
import SettingsPanel from "@/components/ide/SettingsPanel";
import { useFileSystem, FileNode } from "@/hooks/useFileSystem";
import { useFileSystemRemote } from "@/hooks/useFileSystemRemote";
import { useCheckpoints } from "@/hooks/useCheckpoints";
import { useSidebarResizable, useResizable } from "@/hooks/useResizable";
import { WorkspaceContext, CheckpointManager } from "@/hooks/useChat";
import { db } from "@/lib/db";
import {
  GitBranch,
  AlertCircle,
  CheckCircle2,
  Terminal,
  ChevronUp,
  ChevronDown,
  Globe,
  Rocket,
  ExternalLink,
  Loader2,
  HelpCircle,
  Wifi,
  WifiOff,
  Clock,
  Upload,
  X,
  Paperclip,
} from "lucide-react";
import { deploySite, DeployResult } from "@/lib/deploy";
import { useProjects } from "@/hooks/useProjects";
import { FolderPicker } from "./FolderPicker";
import { CloneRepoModal } from "./CloneRepoModal";
import { ToastViewport } from "./ToastViewport";
import { HelpDialog } from "@/components/ide/HelpDialog";
import { NotificationCenter } from "@/components/ide/NotificationCenter";
import { ProblemsPanel } from "@/components/ide/ProblemsPanel";
import { useNotifications } from "@/contexts/NotificationContext";
import { useProblems } from "@/contexts/ProblemsContext";
import { useGitStatusCount } from "@/hooks/useGitStatusCount";
import { useRealGit } from "@/hooks/useRealGit";

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
  const tabsRestoredRef = useRef(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  // Persist terminal height in localStorage
  const terminalResize = useResizable(
    typeof window !== "undefined" ? Number(localStorage.getItem("pipilot-terminal-height")) || 280 : 280,
    120,
    700,
    "vertical"
  );
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("pipilot-terminal-height", String(terminalResize.size));
    }
  }, [terminalResize.size]);
  const [deploying, setDeploying] = useState(false);
  const [lastDeploy, setLastDeploy] = useState<DeployResult | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);

  // ── IDE-wide appearance wiring ──
  // Applies theme, font family, and font size to the entire IDE (not just
  // the Monaco editor) by setting CSS custom properties on <html>. Every
  // UI component that uses `font-family: var(--ide-font)` or
  // `font-size: var(--ide-font-size)` will react instantly.
  useEffect(() => {
    const root = document.documentElement;

    function applyTheme(value: string) {
      const isDark = value !== "light";
      root.classList.toggle("dark", isDark);
      window.dispatchEvent(new CustomEvent("pipilot:monaco-theme-changed", {
        detail: { theme: isDark ? "pipilot-editorial" : "vs" },
      }));
    }

    function applyFontFamily(value: string) {
      // Set a CSS variable AND directly set the body font-family so every
      // element in the IDE inherits the change without needing var() usage.
      const family = value || '"JetBrains Mono", monospace';
      root.style.setProperty("--ide-font", family);
      document.body.style.fontFamily = family;
    }

    function applyFontSize(value: string) {
      const px = parseInt(value) || 14;
      root.style.setProperty("--ide-font-size", `${px}px`);
    }

    // Apply saved values on mount
    applyTheme(localStorage.getItem("pipilot:theme") ?? "dark");
    applyFontFamily(localStorage.getItem("pipilot:editorFontFamily") ?? "");
    applyFontSize(localStorage.getItem("pipilot:editorFontSize") ?? "14");

    function onSettingChanged(e: Event) {
      const { key, value } = (e as CustomEvent<{ key: string; value: string }>).detail ?? {};
      if (key === "theme") applyTheme(value);
      if (key === "editorFontFamily") applyFontFamily(value);
      if (key === "editorFontSize") applyFontSize(value);
    }
    window.addEventListener("pipilot:setting-changed", onSettingChanged);
    return () => window.removeEventListener("pipilot:setting-changed", onSettingChanged);
  }, []);

  // ── Status bar: live clock + online status ──
  const [clockStr, setClockStr] = useState(() => {
    const now = new Date();
    return now.toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  });
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  useEffect(() => {
    const tick = setInterval(() => {
      const now = new Date();
      setClockStr(now.toLocaleString(undefined, {
        weekday: "short", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      }));
    }, 10_000); // update every 10s — minute precision is fine
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      clearInterval(tick);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  // Persist problems panel height in localStorage (mirrors terminalResize)
  const problemsResize = useResizable(
    typeof window !== "undefined" ? Number(localStorage.getItem("pipilot-problems-height")) || 260 : 260,
    120,
    600,
    "vertical"
  );
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("pipilot-problems-height", String(problemsResize.size));
    }
  }, [problemsResize.size]);
  // TitleBar modals
  const [showOpenFolderPicker, setShowOpenFolderPicker] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  // Single provider — PiPilot Agent. Kept as a const for the existing
  // branching that routes file ops to remoteFs vs localFs.
  const activeProvider = "claude-agent" as const;

  const { addNotification } = useNotifications();
  const { errorCount, warningCount } = useProblems();
  const gitChangeCount = useGitStatusCount();
  const git = useRealGit();
  const { branch: gitBranch, branches: gitBranches, isRepo: gitIsRepo, checkout: gitCheckout, createBranch: gitCreateBranch, refreshStatus: gitRefreshStatus } = git;
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [branchCreating, setBranchCreating] = useState(false);
  const branchPickerRef = useRef<HTMLDivElement>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);
  const bellRef = useRef<HTMLElement>(null);

  const sidebar = useSidebarResizable(220, 140, 400);
  const chatPanel = useResizable(360, 260, 600, "horizontal");
  const { activeProject, openFolder: openFolderInProjects } = useProjects();

  const localFs = useFileSystem();
  const remoteFs = useFileSystemRemote();
  // Linked folders ALWAYS use the server-backed filesystem since their
  // files live on real disk, not in IndexedDB. activeProject is read
  // below from useProjects(); we need its type here so use a quick read.
  const isLinkedProject = activeProject?.type === "linked";
  const { files, isReady, executeTool, updateFileContent, getFileContent, loadFolderChildren, activeProjectId } =
    (activeProvider === "claude-agent" || isLinkedProject) ? remoteFs : localFs;
  const checkpoints = useCheckpoints();


  // File operation callbacks — route to DB or server based on mode
  const handleCreateFile = useCallback(async (filePath: string, content: string = "") => {
    if (activeProvider === "claude-agent") {
      await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, path: filePath, content }),
      });
    } else {
      const name = filePath.split("/").pop() || filePath;
      const parentPath = filePath.includes("/") ? filePath.split("/").slice(0, -1).join("/") : "";
      const ext = name.split(".").pop()?.toLowerCase() || "";
      const langMap: Record<string, string> = { tsx: "typescript", jsx: "typescript", ts: "typescript", js: "javascript", json: "json", md: "markdown", css: "css", html: "html" };
      await db.files.put({
        id: filePath, name, type: "file", parentPath,
        language: langMap[ext] || "plaintext", content,
        projectId: activeProjectId, createdAt: new Date(), updatedAt: new Date(),
      });
    }
  }, [activeProvider, activeProjectId]);

  const handleCreateFolder = useCallback(async (folderPath: string) => {
    if (activeProvider === "claude-agent") {
      await fetch("/api/files/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, path: folderPath }),
      });
    } else {
      const name = folderPath.split("/").pop() || folderPath;
      const parentPath = folderPath.includes("/") ? folderPath.split("/").slice(0, -1).join("/") : "";
      await db.files.put({
        id: folderPath, name, type: "folder", parentPath,
        projectId: activeProjectId, createdAt: new Date(), updatedAt: new Date(),
      });
    }
  }, [activeProvider, activeProjectId]);

  const handleRenameFile = useCallback(async (oldPath: string, newPath: string) => {
    if (activeProvider === "claude-agent") {
      await fetch("/api/files/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, oldPath, newPath }),
      });
    } else {
      const file = await db.files.get(oldPath);
      if (file) {
        const name = newPath.split("/").pop() || newPath;
        const parentPath = newPath.includes("/") ? newPath.split("/").slice(0, -1).join("/") : "";
        await db.files.put({ ...file, id: newPath, name, parentPath, updatedAt: new Date() });
        await db.files.delete(oldPath);
      }
    }
  }, [activeProvider, activeProjectId]);

  const handleDeleteFile = useCallback(async (filePath: string) => {
    if (activeProvider === "claude-agent") {
      await fetch(`/api/files?projectId=${encodeURIComponent(activeProjectId)}&path=${encodeURIComponent(filePath)}`, { method: "DELETE" });
    } else {
      const file = await db.files.get(filePath);
      if (file?.type === "folder") {
        const children = await db.files.toArray();
        const toDelete = children.filter(f => f.id === filePath || f.id.startsWith(filePath + "/"));
        await db.files.bulkDelete(toDelete.map(f => f.id));
      } else {
        await db.files.delete(filePath);
      }
    }
  }, [activeProvider, activeProjectId]);

  const handleUpdateFileContent = useCallback(async (filePath: string, content: string) => {
    if (activeProvider === "claude-agent") {
      await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, path: filePath, content }),
      });
    } else {
      await db.files.update(filePath, { content, updatedAt: new Date() });
    }
  }, [activeProvider, activeProjectId]);

  // Read file content — routes to API (agent mode) or IndexedDB (local mode)
  const handleGetFileContent = useCallback(async (filePath: string): Promise<string> => {
    if (activeProvider === "claude-agent") {
      try {
        const res = await fetch(`/api/files/read?projectId=${encodeURIComponent(activeProjectId)}&path=${encodeURIComponent(filePath)}`);
        if (!res.ok) return "";
        const data = await res.json();
        return data.content || "";
      } catch {
        return "";
      }
    } else {
      const file = await db.files.get(filePath);
      return file?.content || "";
    }
  }, [activeProvider, activeProjectId]);

  // Check if a file/folder exists — routes to API (agent mode) or IndexedDB (local mode)
  const handleCheckFileExists = useCallback(async (filePath: string): Promise<boolean> => {
    if (activeProvider === "claude-agent") {
      try {
        const res = await fetch(`/api/files/read?projectId=${encodeURIComponent(activeProjectId)}&path=${encodeURIComponent(filePath)}`);
        return res.ok;
      } catch {
        return false;
      }
    } else {
      const file = await db.files.get(filePath);
      return !!file;
    }
  }, [activeProvider, activeProjectId]);

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

        // In agent mode, deploy from disk files via server API
        if (activeProvider === "claude-agent") {
          try {
            const treeRes = await fetch(`/api/files/tree?projectId=${encodeURIComponent(activeProjectId)}`);
            const treeData = await treeRes.json();
            const flatFiles: { path: string; content: string }[] = [];
            function flattenTree(nodes: any[]) {
              for (const n of nodes) {
                if (n.type === "file" && n.content) flatFiles.push({ path: n.id, content: n.content });
                if (n.children) flattenTree(n.children);
              }
            }
            flattenTree(treeData.files || []);
            const slug = customSlug || activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            const previewUrl = `/api/preview/${activeProjectId}/index.html`;
            addNotification({ title: "Preview Ready", message: `Preview at: ${previewUrl}`, type: "success" });
            return `Preview available at: ${previewUrl} (${flatFiles.length} files on disk). Full deploy coming soon.`;
          } catch (err: any) {
            return `Deploy error: ${err.message}`;
          }
        }

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
    [executeTool, checkpoints, activeProject, activeProjectId, activeProvider]
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

  const handleSelectFile = useCallback(async (node: FileNode) => {
    if (node.type !== "file") return;

    // Lazy-loaded files (e.g. from node_modules) don't include content
    // in the tree response — fetch it on demand here.
    let nodeWithContent = node;
    if (node.content == null) {
      try {
        const content = await getFileContent(node.id);
        nodeWithContent = { ...node, content };
      } catch {
        nodeWithContent = { ...node, content: "" };
      }
    }

    setTabs((prev) => {
      const exists = prev.find((t) => t.node.id === node.id);
      if (exists) {
        setActiveTabId(node.id);
        return prev;
      }
      setActiveTabId(node.id);
      return [...prev, { node: nodeWithContent, isDirty: false }];
    });
  }, [getFileContent]);

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

  const handleOpenCommit = useCallback((oid: string, shortOid: string) => {
    const tabId = `__commit__${oid}`;
    setTabs((prev) => {
      const exists = prev.find((t) => t.node.id === tabId);
      if (exists) {
        setActiveTabId(tabId);
        return prev;
      }
      setActiveTabId(tabId);
      return [
        ...prev,
        {
          node: { id: tabId, name: `Commit ${shortOid}`, type: "file" as const },
          isDirty: false,
          isCommit: true,
          commitOid: oid,
        },
      ];
    });
  }, []);

  const handleNavigateToFile = useCallback(
    async (filePath: string, line?: number, column?: number) => {
      // Normalize path: strip leading slash
      const normalized = filePath.replace(/^\/+/, "");

      // Try to find the file in the current tree first
      let node: FileNode | null = findFileById(files, normalized);

      // If it's not in the tree (race condition with file watcher, or
      // the agent just wrote it), fetch its content from the server and
      // build a synthetic FileNode so the editor can open it.
      if (!node || node.type !== "file") {
        try {
          const content = await getFileContent(normalized);
          const name = normalized.split("/").pop() || normalized;
          const ext = name.split(".").pop()?.toLowerCase() || "";
          const langMap: Record<string, string> = {
            ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
            json: "json", html: "html", css: "css", md: "markdown", py: "python",
            svg: "xml", xml: "xml", yml: "yaml", yaml: "yaml",
            sh: "shell", bash: "shell", mjs: "javascript", cjs: "javascript",
          };
          node = {
            id: normalized,
            name,
            type: "file",
            language: langMap[ext] || "plaintext",
            content,
          };
        } catch (err) {
          console.warn("[navigate] file not found:", normalized, err);
          return;
        }
      }

      const fileNode = node;

      // Open it (or activate existing tab)
      setTabs((prev) => {
        const exists = prev.find((t) => t.node.id === normalized);
        if (!exists) {
          setActiveTabId(normalized);
          return [...prev, { node: fileNode, isDirty: false }];
        }
        setActiveTabId(normalized);
        return prev;
      });
      // Dispatch a custom event for the EditorArea to jump the cursor
      if (line) {
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("pipilot:goto-line", {
              detail: { filePath: normalized, line, column: column || 1 },
            }),
          );
        }, 100);
      }
    },
    [files, getFileContent],
  );

  // Listen for `pipilot:open-file` events from anywhere in the IDE
  // (chat tool pills, problems panel, etc.)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { filePath: string; line?: number; column?: number }
        | undefined;
      if (!detail?.filePath) return;
      handleNavigateToFile(detail.filePath, detail.line, detail.column);
    };
    window.addEventListener("pipilot:open-file", handler);
    return () => window.removeEventListener("pipilot:open-file", handler);
  }, [handleNavigateToFile]);

  const handleOpenSettings = useCallback(() => {
    const tabId = "__settings__";
    setTabs((prev) => {
      const exists = prev.find((t) => t.node.id === tabId);
      if (exists) {
        setActiveTabId(tabId);
        return prev;
      }
      setActiveTabId(tabId);
      return [
        ...prev,
        {
          node: { id: tabId, name: "Settings", type: "file" as const },
          isDirty: false,
          isSettings: true,
        },
      ];
    });
  }, []);

  const handleOpenWalkthrough = useCallback((walkthroughId: string) => {
    const tabId = `__walkthrough__${walkthroughId}`;
    const names: Record<string, string> = {
      "get-started": "Get Started",
      "ai-power": "AI Power User",
    };
    setTabs((prev) => {
      const exists = prev.find((t) => t.node.id === tabId);
      if (exists) {
        setActiveTabId(tabId);
        return prev;
      }
      setActiveTabId(tabId);
      return [
        ...prev,
        {
          node: { id: tabId, name: names[walkthroughId] || "Walkthrough", type: "file" as const },
          isDirty: false,
          isWalkthrough: true,
          walkthroughId,
        },
      ];
    });
  }, []);

  const handleOpenWikiPage = useCallback((pageId: string, title: string) => {
    const tabId = `__wiki__${pageId}`;
    setTabs((prev) => {
      const exists = prev.find((t) => t.node.id === tabId);
      if (exists) {
        setActiveTabId(tabId);
        return prev;
      }
      setActiveTabId(tabId);
      return [
        ...prev,
        {
          node: { id: tabId, name: `Wiki: ${title}`, type: "file" as const },
          isDirty: false,
          isWiki: true,
          wikiPageId: pageId,
        },
      ];
    });
  }, []);

  // Listen for wiki page open events from WikiPanel
  useEffect(() => {
    const handler = (e: Event) => {
      const { pageId, title } = (e as CustomEvent).detail || {};
      if (pageId) handleOpenWikiPage(pageId, title || pageId);
    };
    window.addEventListener("pipilot:open-wiki-page", handler);
    return () => window.removeEventListener("pipilot:open-wiki-page", handler);
  }, [handleOpenWikiPage]);

  // Listen for file open events from wiki links (e.g. "src/components/MapView.tsx")
  useEffect(() => {
    const handler = (e: Event) => {
      const { filePath } = (e as CustomEvent).detail || {};
      if (!filePath) return;
      // Find the file in the tree and open it
      const findNode = (nodes: FileNode[]): FileNode | null => {
        for (const n of nodes) {
          if (n.id === filePath || n.id.endsWith(`/${filePath}`)) return n;
          if (n.children) {
            const found = findNode(n.children);
            if (found) return found;
          }
        }
        return null;
      };
      const node = findNode(files);
      if (node) handleSelectFile(node);
    };
    window.addEventListener("pipilot:open-file", handler);
    return () => window.removeEventListener("pipilot:open-file", handler);
  }, [files, handleSelectFile]);

  const handleOpenDiff = useCallback((filePath: string, staged: boolean) => {
    const tabId = `__diff__${staged ? "s" : "u"}__${filePath}`;
    const fileName = filePath.split("/").pop() || filePath;
    setTabs((prev) => {
      const exists = prev.find((t) => t.node.id === tabId);
      if (exists) {
        setActiveTabId(tabId);
        return prev;
      }
      setActiveTabId(tabId);
      return [
        ...prev,
        {
          node: { id: tabId, name: `${fileName} (diff)`, type: "file" as const },
          isDirty: false,
          isDiff: true,
          diffPath: filePath,
          diffStaged: staged,
        },
      ];
    });
  }, []);

  const handleCloseTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        // Pinned tabs aren't removed by single Close action either, but we
        // honor explicit close on the pinned tab itself.
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

  // Bulk close operations from the tab context menu. Pinned tabs survive
  // "Close Others/Left/Right/All" — matching VS Code behavior.
  const handleCloseOtherTabs = useCallback((keepId: string) => {
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.node.id === keepId || t.isPinned);
      setActiveTabId(remaining.find((t) => t.node.id === keepId)?.node.id ?? remaining[0]?.node.id ?? null);
      return remaining;
    });
  }, []);

  const handleCloseTabsToLeft = useCallback((pivotId: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.node.id === pivotId);
      if (idx <= 0) return prev;
      const remaining = prev.filter((t, i) => i >= idx || t.isPinned);
      if (!remaining.find((t) => t.node.id === activeTabId)) {
        setActiveTabId(pivotId);
      }
      return remaining;
    });
  }, [activeTabId]);

  const handleCloseTabsToRight = useCallback((pivotId: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.node.id === pivotId);
      if (idx < 0 || idx === prev.length - 1) return prev;
      const remaining = prev.filter((t, i) => i <= idx || t.isPinned);
      if (!remaining.find((t) => t.node.id === activeTabId)) {
        setActiveTabId(pivotId);
      }
      return remaining;
    });
  }, [activeTabId]);

  const handleCloseAllTabs = useCallback(() => {
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.isPinned);
      setActiveTabId(remaining[0]?.node.id ?? null);
      return remaining;
    });
  }, []);

  const handleTogglePinTab = useCallback((id: string) => {
    setTabs((prev) => {
      // When pinning, also move to the front of the tab strip (after other pinned ones)
      const idx = prev.findIndex((t) => t.node.id === id);
      if (idx < 0) return prev;
      const target = prev[idx];
      const isPinning = !target.isPinned;
      const next = [...prev];
      next[idx] = { ...target, isPinned: isPinning };
      if (isPinning) {
        // Move it to the end of the existing pinned section
        const updated = next[idx];
        next.splice(idx, 1);
        const lastPinnedIdx = next.findLastIndex((t) => t.isPinned);
        next.splice(lastPinnedIdx + 1, 0, updated);
      }
      return next;
    });
  }, []);

  const handleReorderTabs = useCallback((from: number, to: number) => {
    setTabs((prev) => {
      if (from === to || from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  // ── Persist open tabs to localStorage ──
  // Save: whenever tabs or activeTabId change, write a lightweight
  // manifest (just file ids, pinned state, and which tab is active).
  // Content is NOT saved — it's re-read from the file tree on restore.
  useEffect(() => {
    if (!activeProjectId || !tabsRestoredRef.current) return;
    const manifest = {
      tabIds: tabs
        .filter((t) => !t.isPreview && !t.isCommit && !t.isDiff && !t.isSettings && !t.isWalkthrough)
        .map((t) => ({ id: t.node.id, pinned: !!t.isPinned })),
      activeId: activeTabId,
    };
    try {
      localStorage.setItem(`pipilot-tabs-${activeProjectId}`, JSON.stringify(manifest));
    } catch {}
  }, [tabs, activeTabId, activeProjectId]);

  // Restore: when the file tree is loaded (files.length > 0) and we
  // haven't restored yet, read the manifest and re-open matching files.
  useEffect(() => {
    if (!activeProjectId || !files.length || tabsRestoredRef.current) return;
    tabsRestoredRef.current = true;
    try {
      const raw = localStorage.getItem(`pipilot-tabs-${activeProjectId}`);
      if (!raw) return;
      const manifest = JSON.parse(raw) as { tabIds: { id: string; pinned?: boolean }[]; activeId: string | null };
      if (!manifest.tabIds?.length) return;

      // Build a flat lookup from the file tree
      const fileMap = new Map<string, FileNode>();
      const walk = (nodes: FileNode[]) => {
        for (const n of nodes) {
          if (n.type === "file") fileMap.set(n.id, n);
          if (n.children) walk(n.children);
        }
      };
      walk(files);

      // Restore tabs that still exist in the tree
      const restored: EditorTab[] = [];
      for (const entry of manifest.tabIds) {
        const node = fileMap.get(entry.id);
        if (node) {
          restored.push({ node, isDirty: false, isPinned: entry.pinned });
        }
      }
      if (restored.length > 0) {
        setTabs(restored);
        // Restore active tab — fall back to first restored if the saved one is gone
        const activeExists = restored.some((t) => t.node.id === manifest.activeId);
        setActiveTabId(activeExists ? manifest.activeId : restored[0].node.id);
      }
    } catch {}
  }, [activeProjectId, files]);

  // Reset the restored flag when the project changes so the next project
  // gets its own tabs restored.
  useEffect(() => {
    tabsRestoredRef.current = false;
  }, [activeProjectId]);

  // Auto-refresh editor tabs when files change on disk (agent mode)
  useEffect(() => {
    if (!files.length || !tabs.length) return;

    // Build a flat map of file paths → content from the current tree
    const contentMap = new Map<string, string>();
    function walk(nodes: FileNode[]) {
      for (const node of nodes) {
        if (node.type === "file" && node.content !== undefined) {
          contentMap.set(node.id, node.content);
        }
        if (node.children) walk(node.children);
      }
    }
    walk(files);

    // Check if any open tab's content has changed
    setTabs((prevTabs) => {
      let changed = false;
      const newTabs = prevTabs.map((tab) => {
        if (tab.isPreview || !tab.node || tab.node.type !== "file") return tab;
        const newContent = contentMap.get(tab.node.id);
        if (newContent !== undefined && newContent !== tab.node.content) {
          changed = true;
          return { ...tab, node: { ...tab.node, content: newContent }, isDirty: false };
        }
        return tab;
      });
      return changed ? newTabs : prevTabs;
    });
  }, [files]);

  // Handle editor content changes — always auto-save with per-file
  // debounce. Rapid keystrokes are batched into a single write 400ms
  // after the last change. For linked projects this avoids a POST per
  // keystroke; for local projects it avoids IndexedDB thrash.
  const saveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const latestContentRef = useRef<Map<string, string>>(new Map());
  const handleEditorChange = useCallback(
    (fileId: string, content: string) => {
      // Update the in-memory tab content immediately so the editor
      // reflects the latest keystroke without waiting for the debounced
      // write. Tabs never become "dirty" since auto-save is guaranteed.
      latestContentRef.current.set(fileId, content);
      setTabs((prev) =>
        prev.map((tab) =>
          tab.node.id === fileId
            ? { ...tab, node: { ...tab.node, content }, isDirty: false }
            : tab
        )
      );

      // Debounce the actual write
      const existing = saveTimersRef.current.get(fileId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        const latest = latestContentRef.current.get(fileId);
        if (latest !== undefined) {
          updateFileContent(fileId, latest);
          latestContentRef.current.delete(fileId);
        }
        saveTimersRef.current.delete(fileId);
      }, 400);
      saveTimersRef.current.set(fileId, timer);
    },
    [updateFileContent]
  );

  // Flush any pending auto-save writes when the component unmounts
  // (page close, project switch, etc.) so no keystrokes are lost.
  useEffect(() => {
    const timers = saveTimersRef.current;
    const latest = latestContentRef.current;
    return () => {
      for (const [fileId, timer] of timers) {
        clearTimeout(timer);
        const content = latest.get(fileId);
        if (content !== undefined) {
          updateFileContent(fileId, content);
        }
      }
      timers.clear();
      latest.clear();
    };
  }, [updateFileContent]);

  // Ctrl/Cmd+S fires `pipilot:file-saved` from the editor — flush any
  // pending debounced writes immediately so the "Saved" toast is truthful.
  useEffect(() => {
    const onFlush = () => {
      for (const [fileId, timer] of saveTimersRef.current) {
        clearTimeout(timer);
        const content = latestContentRef.current.get(fileId);
        if (content !== undefined) {
          updateFileContent(fileId, content);
          latestContentRef.current.delete(fileId);
        }
      }
      saveTimersRef.current.clear();
    };
    window.addEventListener("pipilot:file-saved", onFlush);
    return () => window.removeEventListener("pipilot:file-saved", onFlush);
  }, [updateFileContent]);

  // Listen for walkthrough open events from WelcomePage
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail?.id;
      if (id) handleOpenWalkthrough(id);
    };
    window.addEventListener("pipilot:open-walkthrough", handler);
    return () => window.removeEventListener("pipilot:open-walkthrough", handler);
  }, [handleOpenWalkthrough]);

  // Close branch picker on outside click
  useEffect(() => {
    if (!showBranchPicker) return;
    const onDown = (e: MouseEvent) => {
      if (branchPickerRef.current && !branchPickerRef.current.contains(e.target as Node)) {
        setShowBranchPicker(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showBranchPicker]);

  // Keyboard shortcuts
  // Listen for the Welcome Page's "open chat" event
  useEffect(() => {
    const openChat = () => setChatOpen(true);
    const openTerminal = () => { setTerminalOpen(true); setProblemsOpen(false); };
    window.addEventListener("pipilot:open-chat", openChat);
    const openSettings = () => setActiveView("settings");
    const openFolderPicker = () => setShowOpenFolderPicker(true);
    const openGenerateModal = () => setShowGenerateModal(true);
    const openExtensions = (e: Event) => {
      setActiveView("extensions");
      // Forward the detail (e.g. { tab: "connectors" }) so the panel can auto-switch
      const detail = (e as CustomEvent).detail;
      if (detail?.tab) {
        setTimeout(() => window.dispatchEvent(new CustomEvent("pipilot:extensions-set-tab", { detail })), 50);
      }
    };
    window.addEventListener("pipilot:open-extensions", openExtensions);
    window.addEventListener("pipilot:open-terminal", openTerminal);
    window.addEventListener("pipilot:open-settings", openSettings);
    window.addEventListener("pipilot:open-folder-picker", openFolderPicker);
    window.addEventListener("pipilot:open-generate-modal", openGenerateModal);
    window.addEventListener("pipilot:show-generate-modal", openGenerateModal);
    return () => {
      window.removeEventListener("pipilot:open-chat", openChat);
      window.removeEventListener("pipilot:open-extensions", openExtensions);
      window.removeEventListener("pipilot:open-terminal", openTerminal);
      window.removeEventListener("pipilot:open-settings", openSettings);
      window.removeEventListener("pipilot:open-folder-picker", openFolderPicker);
      window.removeEventListener("pipilot:open-generate-modal", openGenerateModal);
      window.removeEventListener("pipilot:show-generate-modal", openGenerateModal);
    };
  }, []);

  // Generic notification dispatcher — any component can fire `pipilot:notify`
  // with { type, title, message } and have it land in the bell center.
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as {
        type?: "info" | "success" | "warning" | "error";
        title: string;
        message?: string;
      } | undefined;
      if (!d?.title) return;
      addNotification({
        title: d.title,
        message: d.message || "",
        type: d.type || "info",
      });
    };
    window.addEventListener("pipilot:notify", handler);
    return () => window.removeEventListener("pipilot:notify", handler);
  }, [addNotification]);

  // Listen for "new file" requests from the Welcome page
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail as { path: string; content?: string } | undefined;
      if (!detail?.path) return;
      try {
        await handleCreateFile(detail.path, detail.content ?? "");
      } catch (err) {
        console.error("Failed to create file:", err);
      }
    };
    window.addEventListener("pipilot:new-file", handler);
    return () => window.removeEventListener("pipilot:new-file", handler);
  }, [handleCreateFile]);

  // ── TitleBar handlers ──
  const titleBarHandlers = useMemo(() => {
    const editorAction = (action: string) =>
      window.dispatchEvent(new CustomEvent("pipilot:editor-action", { detail: { action } }));

    return {
      onNewFile: () => {
        if (!activeProjectId || activeProjectId === "default-project") {
          window.dispatchEvent(new CustomEvent("pipilot:open-folder-picker"));
          return;
        }
        const name = prompt("New file (path):");
        if (!name?.trim()) return;
        handleCreateFile(name.trim(), "").catch((err) =>
          alert("Failed: " + (err instanceof Error ? err.message : String(err))),
        );
      },
      onNewFolder: () => {
        const name = prompt("New folder (path):");
        if (!name?.trim()) return;
        handleCreateFolder(name.trim()).catch((err) =>
          alert("Failed: " + (err instanceof Error ? err.message : String(err))),
        );
      },
      onOpenFolder: () => setShowOpenFolderPicker(true),
      onCloneRepo: () => setShowCloneModal(true),
      onSaveFile: () => editorAction("save"),
      onSaveAll: () => editorAction("save"),
      onCloseTab: () => { if (activeTabId) handleCloseTab(activeTabId); },
      onCloseAllTabs: () => { setTabs([]); setActiveTabId(null); },
      onOpenSettings: handleOpenSettings,

      onUndo: () => editorAction("undo"),
      onRedo: () => editorAction("redo"),
      onFind: () => editorAction("find"),
      onReplace: () => editorAction("replace"),

      onToggleSidebar: () => setActiveView((prev) => (prev ? null : "explorer")),
      onToggleTerminal: () => setTerminalOpen((p) => { if (!p) setProblemsOpen(false); return !p; }),
      onToggleChat: () => setChatOpen((p) => !p),
      onCommandPalette: () => setCommandPaletteOpen((p) => !p),
      onOpenExplorer: () => setActiveView("explorer"),
      onOpenSearch: () => setActiveView("search"),
      onOpenSourceControl: () => setActiveView("source-control"),
      onOpenProblems: () => { setProblemsOpen(true); setTerminalOpen(false); },
      onOpenExtensions: () => setActiveView("extensions"),

      onRunPreview: handleOpenPreview,
      onDeploy: handleDeploy,

      onNewTerminal: () => { setTerminalOpen(true); setProblemsOpen(false); },

      onWelcome: () => { setTabs([]); setActiveTabId(null); },
      onKeyboardShortcuts: () => setHelpOpen(true),

      // Active state for the layout-toggle cluster on the right side
      sidebarOpen: !!activeView,
      terminalOpen,
      chatOpen,
    };
  }, [
    handleCreateFile, handleCreateFolder, handleOpenSettings, handleCloseTab,
    handleOpenPreview, handleDeploy, activeTabId,
    activeView, terminalOpen, chatOpen,
  ]);


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
        setTerminalOpen((p) => { if (!p) setProblemsOpen(false); return !p; });
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

    // Open tabs: active tab first, then the rest in order
    const openTabPaths = tabs.map((t) => t.node.id);
    if (activeTabId) {
      const idx = openTabPaths.indexOf(activeTabId);
      if (idx > 0) {
        openTabPaths.splice(idx, 1);
        openTabPaths.unshift(activeTabId);
      }
    }

    return {
      fileTree,
      projectType: (activeProject?.type === "cloud" ? "Node.js (E2B Cloud — full npm/Vite/Next.js/SSR) + " : activeProject?.type === "nodebox" ? "Node.js (Nodebox) + " : "") + (techs.length > 0 ? techs.join(" + ") : "HTML + CSS + JavaScript"),
      dependencies: "Tailwind CSS (CDN)",
      openTabs: openTabPaths,
    };
  }, [files, tabs, activeTabId]);

  if (!isReady) {
    return (
      <div style={{
        height: "100vh", width: "100vw",
        background: "#16161a",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        fontFamily: '"DM Sans", -apple-system, sans-serif',
      }}>
        {/* Subtle warm ambient glow */}
        <div style={{
          position: "absolute",
          width: 400, height: 400,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(229,166,57,0.04) 0%, transparent 70%)",
          filter: "blur(60px)",
          pointerEvents: "none",
        }} />

        <div style={{
          position: "relative", zIndex: 1,
          display: "flex", flexDirection: "column",
          alignItems: "center",
          animation: "bootFadeIn 0.6s ease forwards",
          opacity: 0,
        }}>
          <img
            src="/logo.png"
            alt="PiPilot"
            style={{
              width: 56, height: 56,
              objectFit: "contain",
              marginBottom: 20,
              animation: "bootPulse 2.5s ease-in-out infinite",
            }}
          />
          <div style={{
            fontSize: 17, fontWeight: 600,
            color: "#e2e2e6",
            letterSpacing: "-0.01em",
            marginBottom: 6,
          }}>
            PiPilot IDE
          </div>
          <div style={{
            fontSize: 12, fontWeight: 400,
            color: "#6b6b76",
            marginBottom: 28,
          }}>
            Preparing your workspace
          </div>
          {/* Progress bar — amber shimmer */}
          <div style={{
            width: 160, height: 2,
            background: "#2e2e35",
            borderRadius: 1,
            overflow: "hidden",
          }}>
            <div style={{
              width: "35%", height: "100%",
              background: "linear-gradient(90deg, transparent, #e5a639, transparent)",
              borderRadius: 1,
              animation: "bootShimmer 1.8s ease-in-out infinite",
            }} />
          </div>
        </div>
        <style>{`
          @keyframes bootFadeIn {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes bootPulse {
            0%, 100% { opacity: 0.7; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.02); }
          }
          @keyframes bootShimmer {
            0% { transform: translateX(-250%); }
            100% { transform: translateX(450%); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ height: "100vh", width: "100vw", overflow: "hidden" }}>
      {/* Top toolbar */}
      <TitleBar {...titleBarHandlers} />

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

      {/* Folder picker (File → Open Folder) */}
      <FolderPicker
        open={showOpenFolderPicker}
        onClose={() => setShowOpenFolderPicker(false)}
        onPick={async (p) => { await openFolderInProjects(p); }}
      />

      {/* Clone Repository modal (File → Clone Repository) */}
      <CloneRepoModal
        open={showCloneModal}
        onClose={() => setShowCloneModal(false)}
        onCloned={async (path) => { await openFolderInProjects(path); }}
      />

      {/* Generate with AI modal (always mounted) */}
      {showGenerateModal && (
        <GenerateModal
          onClose={() => setShowGenerateModal(false)}
          onGenerate={async (prompt) => {
            setShowGenerateModal(false);
            try {
              const { generateProjectFolderName } = await import("@/lib/a0llm");
              const name = await generateProjectFolderName(prompt);
              await createProject(name, "static", "blank");
              window.dispatchEvent(new CustomEvent("pipilot:open-chat"));
              await new Promise<void>((resolve) => {
                const onReady = () => { window.removeEventListener("pipilot:chat-session-ready", onReady); resolve(); };
                window.addEventListener("pipilot:chat-session-ready", onReady);
                setTimeout(() => { window.removeEventListener("pipilot:chat-session-ready", onReady); resolve(); }, 3000);
              });
              await new Promise((r) => setTimeout(r, 200));
              window.dispatchEvent(new CustomEvent("pipilot:focus-chat-input", { detail: { prefill: prompt, submit: true } }));
            } catch (err: any) {
              console.error("Generate failed:", err);
            }
          }}
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
          onOpenSettings={handleOpenSettings}
          badges={{ "source-control": gitChangeCount }}
        />

        {/* Cloud panel — full width, replaces sidebar + editor */}
        {activeView === "cloud" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            <CloudPanel />
          </div>
        )}

        {/* Deploy panel — full width, replaces sidebar + editor */}
        {activeView === "deploy" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
            <DeploymentPanel />
          </div>
        )}

        {/* Sidebar (hidden when cloud panel is active) */}
        {activeView && activeView !== "cloud" && activeView !== "deploy" && (
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
                onOpenTerminal={() => { setTerminalOpen(true); setProblemsOpen(false); }}
                onOpenCommit={handleOpenCommit}
                onOpenDiff={handleOpenDiff}
                onCreateFile={handleCreateFile}
                onCreateFolder={handleCreateFolder}
                onRenameFile={handleRenameFile}
                onDeleteFile={handleDeleteFile}
                onUpdateFileContent={handleUpdateFileContent}
                onGetFileContent={handleGetFileContent}
                onCheckFileExists={handleCheckFileExists}
                onExpandLazyFolder={loadFolderChildren}
                git={git}
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

        {/* Editor + Terminal area (hidden when cloud panel is active) */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ display: (activeView === "cloud" || activeView === "deploy") ? "none" : undefined }}>
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
            onCloseOtherTabs={handleCloseOtherTabs}
            onCloseTabsToLeft={handleCloseTabsToLeft}
            onCloseTabsToRight={handleCloseTabsToRight}
            onCloseAllTabs={handleCloseAllTabs}
            onTogglePinTab={handleTogglePinTab}
            onReorderTabs={handleReorderTabs}
          />

          {/* Problems panel */}
          {problemsOpen && (
            <>
              {/* Problems panel resize handle */}
              <div
                onMouseDown={problemsResize.onMouseDown}
                style={{
                  height: 4,
                  cursor: "ns-resize",
                  background: problemsResize.isDragging ? "#e5a639" : "#2e2e35",
                  flexShrink: 0,
                  transition: problemsResize.isDragging ? "none" : "background 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!problemsResize.isDragging) e.currentTarget.style.background = "#e5a63980";
                }}
                onMouseLeave={(e) => {
                  if (!problemsResize.isDragging) e.currentTarget.style.background = "#28282f";
                }}
              />
              <div style={{ height: problemsResize.size, minHeight: 120, flexShrink: 0 }}>
                {(!activeProjectId || activeProjectId === "default-project") ? (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, background: "#1c1c21" }}>
                    <span style={{ fontSize: 11, color: "#6b6b76" }}>Open a project to see diagnostics</span>
                    <button onClick={() => window.dispatchEvent(new CustomEvent("pipilot:open-folder-picker"))} style={{ padding: "5px 12px", borderRadius: 4, fontSize: 10, fontFamily: "'Geist Mono', monospace", fontWeight: 600, background: "#232329", border: "1px solid #2e2e35", color: "#b0b0b8", cursor: "pointer" }}>Open Folder</button>
                  </div>
                ) : (
                  <ProblemsPanel
                    onClose={() => setProblemsOpen(false)}
                    onNavigateToFile={handleNavigateToFile}
                  />
                )}
              </div>
            </>
          )}

          {/* Terminal panel */}
          {terminalOpen && (
            <>
              {/* Resize handle */}
              <div
                onMouseDown={terminalResize.onMouseDown}
                style={{
                  height: 4,
                  cursor: "ns-resize",
                  background: terminalResize.isDragging ? "hsl(207 90% 50%)" : "hsl(220 13% 22%)",
                  flexShrink: 0,
                  transition: terminalResize.isDragging ? "none" : "background 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!terminalResize.isDragging) e.currentTarget.style.background = "hsl(207 90% 50% / 0.5)";
                }}
                onMouseLeave={(e) => {
                  if (!terminalResize.isDragging) e.currentTarget.style.background = "hsl(220 13% 22%)";
                }}
              />
              {/* This bar is handled inside TerminalPanel's own header now.
                  No extra chrome needed — TerminalPanel includes the editorial
                  label, shell tabs, and action icons. */}
              <div style={{ height: terminalResize.size - 4, minHeight: 86, flexShrink: 0 }}>
                {(!activeProjectId || activeProjectId === "default-project") ? (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, background: "#1c1c21" }}>
                    <span style={{ fontSize: 11, color: "#6b6b76" }}>Open a project to use the terminal</span>
                    <button onClick={() => window.dispatchEvent(new CustomEvent("pipilot:open-folder-picker"))} style={{ padding: "5px 12px", borderRadius: 4, fontSize: 10, fontFamily: "'Geist Mono', monospace", fontWeight: 600, background: "#232329", border: "1px solid #2e2e35", color: "#b0b0b8", cursor: "pointer" }}>Open Folder</button>
                  </div>
                ) : (
                  <TerminalPanel onClose={() => setTerminalOpen(false)} />
                )}
              </div>
            </>
          )}
        </div>

        {/* Chat panel — multi-agent: each tab gets its own ChatPanel instance */}
        {chatOpen && (
          <>
            <div
              className={`resize-handle ${chatPanel.isDragging ? "dragging" : ""}`}
              onMouseDown={chatPanel.onMouseDown}
              data-testid="chat-resize-handle"
            />
            <div
              className="overflow-hidden flex flex-col"
              style={{
                width: chatPanel.size,
                minWidth: chatPanel.size,
                borderLeft: "1px solid hsl(220 13% 22%)",
              }}
              data-testid="chat-panel-wrapper"
            >
              <ChatPanel
                toolExecutor={toolExecutorWithCheckpoints}
                workspaceContext={workspaceContext}
                checkpointManager={checkpointManagerForChat}
                projectId={activeProjectId}
                fileTree={files}
                openTabIds={tabs.filter((t) => !t.isPreview && !t.isCommit && !t.isDiff && !t.isSettings && !t.isWalkthrough).map((t) => t.node.id)}
                activeTabId={activeTabId}
              />
            </div>
          </>
        )}
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Toast notifications viewport — fixed top-right stack */}
      <ToastViewport />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Status bar */}
      <div className="status-bar" data-testid="status-bar">
        <div style={{ position: "relative" }} ref={branchPickerRef}>
          <button
            className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            onClick={() => {
              if (!gitIsRepo) return;
              setShowBranchPicker((p) => {
                if (!p) gitRefreshStatus(); // fetch latest branches on open
                return !p;
              });
              setBranchFilter("");
              setBranchCreating(false);
              setTimeout(() => branchInputRef.current?.focus(), 50);
            }}
            style={{ background: "none", border: "none", color: "inherit", cursor: gitIsRepo ? "pointer" : "default", fontFamily: "inherit", fontSize: "inherit", padding: 0 }}
          >
            <GitBranch size={11} />
            <span>{gitIsRepo === false ? "no repo" : gitBranch || "—"}</span>
          </button>

          {/* ── Branch picker dropdown ── */}
          {showBranchPicker && gitIsRepo && (() => {
            const filtered = gitBranches.filter((b) =>
              b.toLowerCase().includes(branchFilter.toLowerCase()),
            );
            const exactMatch = gitBranches.some(
              (b) => b.toLowerCase() === branchFilter.trim().toLowerCase(),
            );
            return (
              <div
                style={{
                  position: "absolute",
                  bottom: "100%",
                  left: 0,
                  marginBottom: 4,
                  width: 320,
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 4,
                  boxShadow: "0 -8px 24px rgba(0,0,0,0.4)",
                  zIndex: 10002,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* Search / create input */}
                <div style={{ padding: "8px 8px 4px" }}>
                  <input
                    ref={branchInputRef}
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                    onKeyDown={async (e) => {
                      if (e.key === "Escape") {
                        setShowBranchPicker(false);
                      } else if (e.key === "Enter" && branchFilter.trim()) {
                        if (exactMatch) {
                          // Checkout existing branch
                          try {
                            await gitCheckout(branchFilter.trim());
                            addNotification({ type: "success", title: "Switched branch", message: branchFilter.trim() });
                          } catch (err) {
                            addNotification({ type: "error", title: "Checkout failed", message: String(err) });
                          }
                          setShowBranchPicker(false);
                        } else if (branchCreating) {
                          // Create + checkout new branch
                          try {
                            await gitCreateBranch(branchFilter.trim());
                            await gitCheckout(branchFilter.trim());
                            addNotification({ type: "success", title: "Created & switched to branch", message: branchFilter.trim() });
                          } catch (err) {
                            addNotification({ type: "error", title: "Create branch failed", message: String(err) });
                          }
                          setShowBranchPicker(false);
                        }
                      }
                    }}
                    placeholder="Select a branch or tag to checkout"
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      background: C.bg,
                      border: `1px solid ${C.border}`,
                      borderRadius: 3,
                      color: C.text,
                      fontFamily: FONTS.mono,
                      fontSize: 11,
                      outline: "none",
                    }}
                    autoFocus
                  />
                </div>

                {/* Actions: Create new branch */}
                {branchFilter.trim() && !exactMatch && (
                  <button
                    onClick={async () => {
                      try {
                        await gitCreateBranch(branchFilter.trim());
                        await gitCheckout(branchFilter.trim());
                        addNotification({ type: "success", title: "Created & switched to branch", message: branchFilter.trim() });
                      } catch (err) {
                        addNotification({ type: "error", title: "Create branch failed", message: String(err) });
                      }
                      setShowBranchPicker(false);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "7px 12px",
                      background: "transparent", border: "none",
                      color: C.accent,
                      fontFamily: FONTS.mono, fontSize: 10,
                      cursor: "pointer", textAlign: "left",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ fontSize: 13 }}>+</span>
                    Create new branch "{branchFilter.trim()}"
                  </button>
                )}

                {/* Separator */}
                <div style={{ height: 1, background: C.border }} />

                {/* Branch list — scrollable */}
                <div style={{ maxHeight: 260, overflowY: "auto", padding: "4px 0" }}>
                  {filtered.length === 0 && (
                    <div style={{ padding: "8px 12px", color: C.textDim, fontFamily: FONTS.mono, fontSize: 10 }}>
                      No matching branches
                    </div>
                  )}
                  {filtered.map((b) => {
                    const isCurrent = b === gitBranch;
                    return (
                      <button
                        key={b}
                        onClick={async () => {
                          if (isCurrent) {
                            setShowBranchPicker(false);
                            return;
                          }
                          try {
                            await gitCheckout(b);
                            addNotification({ type: "success", title: "Switched branch", message: b });
                          } catch (err) {
                            addNotification({ type: "error", title: "Checkout failed", message: String(err) });
                          }
                          setShowBranchPicker(false);
                        }}
                        style={{
                          width: "100%",
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "6px 12px",
                          background: "transparent", border: "none",
                          color: isCurrent ? C.accent : C.textMid,
                          fontFamily: FONTS.mono, fontSize: 10,
                          cursor: "pointer", textAlign: "left",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        <GitBranch size={10} style={{ flexShrink: 0, opacity: isCurrent ? 1 : 0.5 }} />
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {b}
                        </span>
                        {isCurrent && (
                          <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 2, background: `${C.accent}22`, color: C.accent }}>
                            current
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
        <button
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
          onClick={() => setProblemsOpen((p) => { if (!p) setTerminalOpen(false); return !p; })}
        >
          {errorCount > 0 ? <AlertCircle size={13} style={{ color: C.error }} /> : <CheckCircle2 size={11} style={{ color: C.ok }} />}
          <span>{errorCount > 0 || warningCount > 0 ? `${errorCount} errors, ${warningCount} warnings` : "No Problems"}</span>
        </button>
        <button
          className="flex items-center gap-1 hover:opacity-80 transition-opacity"
          onClick={() => setTerminalOpen((p) => { if (!p) setProblemsOpen(false); return !p; })}
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
          onClick={() => setActiveView("deploy")}
        >
          <Rocket size={11} />
          <span>Deploy</span>
        </button>
        {lastDeploy?.success && (
          <a
            href={lastDeploy.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:opacity-80 transition-opacity"
            style={{ color: C.info }}
          >
            <ExternalLink size={10} />
            <span className="text-xs truncate" style={{ maxWidth: 120 }}>{lastDeploy.slug}</span>
          </a>
        )}
        <div className="flex-1" />
        {activeFile && (
          <>
            <span>{activeFile.language?.toUpperCase() ?? "Plain Text"}</span>
            <span>UTF-8</span>
          </>
        )}
        {/* Connection status */}
        <div
          className="flex items-center gap-1.5"
          title={isOnline ? "Connected to network" : "No network connection"}
          style={{ color: isOnline ? C.ok : C.error }}
        >
          {isOnline ? <Wifi size={11} /> : <WifiOff size={11} />}
          <span>{isOnline ? "Online" : "Offline"}</span>
        </div>

        {/* System clock */}
        <div className="flex items-center gap-1.5" style={{ color: C.textDim }}>
          <Clock size={10} />
          <span>{clockStr}</span>
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

// ── Generate with AI modal (always mountable from IDELayout) ──
function GenerateModal({ onClose, onGenerate }: { onClose: () => void; onGenerate: (prompt: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [files, setFiles] = useState<{ name: string; path: string }[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const uploadFile = async (file: File) => {
    try {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/files/upload-temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, base64 }),
      });
      const data = await res.json();
      if (data.path) setFiles((prev) => [...prev, { name: file.name, path: data.path }]);
    } catch {}
  };

  const handleSubmit = () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    let fullPrompt = prompt.trim();
    if (files.length > 0) {
      fullPrompt += "\n\n--- Attached reference files ---\n" + files.map((f) => `- ${f.name}: ${f.path}`).join("\n") + "\n\nRead these files for reference context before building.";
    }
    onGenerate(fullPrompt);
  };

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget && !generating) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{
        width: 520, maxWidth: "92vw", background: "#1c1c21",
        border: "1px solid #2e2e35", borderRadius: 10, padding: 28,
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
      }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "#b0b0b8", margin: "0 0 4px" }}>Generate with AI</h3>
        <p style={{ fontSize: 12, color: "#6b6b76", margin: "0 0 18px", lineHeight: 1.5 }}>
          Describe what you want and PiPilot will scaffold it. Drop files for reference.
        </p>

        {/* File pills */}
        {files.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
            {files.map((f, i) => (
              <span key={i} style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "3px 8px", borderRadius: 4, fontSize: 9,
                background: "#16161a", border: "1px solid #2e2e35", color: "#8a8a94",
                fontFamily: "'Geist Mono', monospace",
              }}>
                <Paperclip size={9} /> {f.name}
                <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: "#6b6b76", cursor: "pointer", padding: 0 }}>
                  <X size={8} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "#FF6B35"; }}
          onDragLeave={(e) => { e.currentTarget.style.borderColor = "#2e2e35"; }}
          onDrop={async (e) => {
            e.preventDefault();
            e.currentTarget.style.borderColor = "#2e2e35";
            for (const file of Array.from(e.dataTransfer.files)) await uploadFile(file);
          }}
          style={{ border: "1px solid #2e2e35", borderRadius: 5, overflow: "hidden", transition: "border-color 0.2s", marginBottom: 10 }}
        >
          <textarea
            ref={ref} value={prompt} rows={4}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit(); if (e.key === "Escape" && !generating) onClose(); }}
            placeholder="A retro-arcade landing page for a synthwave music label…"
            style={{
              width: "100%", padding: "12px 14px", fontSize: 13, lineHeight: 1.5,
              background: "#16161a", color: "#b0b0b8", border: "none",
              outline: "none", resize: "vertical",
              fontFamily: "'DM Sans', sans-serif",
            }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="file" ref={fileRef} style={{ display: "none" }} multiple
            onChange={async (e) => { for (const file of Array.from(e.target.files || [])) await uploadFile(file); e.target.value = ""; }}
          />
          <button onClick={() => fileRef.current?.click()} style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "6px 10px", borderRadius: 4, fontSize: 9,
            fontFamily: "'Geist Mono', monospace", fontWeight: 600,
            background: "transparent", border: "1px solid #2e2e35", color: "#8a8a94", cursor: "pointer",
          }}>
            <Upload size={10} /> Attach files
          </button>
          <span style={{ flex: 1, fontFamily: "'Geist Mono', monospace", fontSize: 9, color: "#6b6b76", textAlign: "right" }}>
            {files.length > 0 ? `${files.length} file${files.length !== 1 ? "s" : ""}` : ""}
          </span>
          <button onClick={onClose} disabled={generating} style={{
            padding: "8px 16px", fontSize: 10, fontWeight: 500,
            background: "transparent", color: "#8a8a94", border: "1px solid #2e2e35",
            borderRadius: 4, cursor: generating ? "not-allowed" : "pointer",
            fontFamily: "'Geist Mono', monospace", letterSpacing: "0.08em", textTransform: "uppercase",
          }}>Cancel</button>
          <button onClick={handleSubmit} disabled={!prompt.trim() || generating} style={{
            padding: "8px 16px", fontSize: 10, fontWeight: 600,
            background: !prompt.trim() || generating ? "#232329" : "#FF6B35",
            color: !prompt.trim() || generating ? "#42424a" : "#16161a",
            border: "none", borderRadius: 4,
            cursor: !prompt.trim() || generating ? "not-allowed" : "pointer",
            fontFamily: "'Geist Mono', monospace", letterSpacing: "0.08em", textTransform: "uppercase",
          }}>{generating ? "Starting…" : "Generate →"}</button>
        </div>
      </div>
    </div>
  );
}
