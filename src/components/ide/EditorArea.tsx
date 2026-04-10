import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import Editor, { OnMount, loader } from "@monaco-editor/react";
import { X, Circle, ChevronRight, FileCode2, FileJson, FileText, FileType, Folder, Globe, GitCommit, Settings } from "lucide-react";
import { FileNode } from "@/hooks/useFileSystem";
import { WebPreview } from "./WebPreview";
import { CommitDetailView } from "./CommitDetailView";
import { FileDiffView } from "./FileDiffView";
import { SettingsTabView } from "./SettingsTabView";
import { registerInlineAI } from "@/hooks/useInlineAI";
import { useSettings } from "@/hooks/useSettings";
import { useActiveProject } from "@/contexts/ProjectContext";

export interface EditorTab {
  node: FileNode;
  isDirty: boolean;
  isPreview?: boolean;     // special tab for web preview
  isCommit?: boolean;      // special tab for commit detail view
  commitOid?: string;      // full commit hash (when isCommit)
  isDiff?: boolean;        // special tab for file diff view
  diffPath?: string;       // file path being diffed (when isDiff)
  diffStaged?: boolean;    // whether to show staged or unstaged diff
  isSettings?: boolean;    // special tab for settings view
}

interface EditorAreaProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onActivateTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onContentChange?: (fileId: string, content: string) => void;
  allFiles?: FileNode[];
  onSelectFile?: (node: FileNode) => void;
  onOpenPreview?: () => void;
  projectType?: "static" | "nodebox";
}

// ── Breadcrumb with dropdown navigation ──

function getSmallIcon(name: string, type: "file" | "folder") {
  if (type === "folder") return <Folder size={12} className="text-yellow-400" />;
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "tsx": case "jsx":
      return <FileCode2 size={12} className="text-blue-400" />;
    case "ts": case "js":
      return <FileCode2 size={12} className="text-yellow-400" />;
    case "json":
      return <FileJson size={12} className="text-yellow-300" />;
    case "css":
      return <FileType size={12} className="text-blue-400" />;
    default:
      return <FileText size={12} className="text-gray-400" />;
  }
}

/**
 * Find the siblings at a given breadcrumb depth.
 * For segmentIndex 0, returns root-level items.
 * For segmentIndex N, drills into folders matching pathParts[0..N-1]
 * and returns all children at that level.
 */
function findSiblings(allFiles: FileNode[], pathParts: string[], segmentIndex: number): FileNode[] {
  if (!allFiles || allFiles.length === 0) return [];

  let current = allFiles;

  for (let i = 0; i < segmentIndex; i++) {
    const folderName = pathParts[i];
    // Try matching by name first, then by id segment
    const match = current.find(
      (n) => n.type === "folder" && (n.name === folderName || n.id.endsWith("/" + folderName) || n.id === folderName)
    );
    if (!match) return current; // fallback: show current level if we can't drill deeper
    if (!match.children || match.children.length === 0) return [];
    current = match.children;
  }

  return current;
}

interface BreadcrumbSegmentProps {
  label: string;
  isLast: boolean;
  siblings: FileNode[];
  onSelectFile?: (node: FileNode) => void;
}

function BreadcrumbSegment({ label, isLast, siblings, onSelectFile }: BreadcrumbSegmentProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  // Position the dropdown below the button using a portal
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 2, left: rect.left });
  }, [open]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const sorted = [...siblings].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <>
      <button
        ref={buttonRef}
        className="flex items-center gap-0.5 px-1 py-0.5 rounded transition-colors hover:bg-white/8"
        style={{ color: isLast ? "hsl(220 14% 85%)" : "hsl(220 14% 60%)" }}
        onClick={() => setOpen((p) => !p)}
      >
        <span className="text-xs">{label}</span>
        <ChevronRight
          size={10}
          className="transition-transform"
          style={{
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            color: "hsl(220 14% 45%)",
          }}
        />
      </button>

      {open && sorted.length > 0 &&
        createPortal(
          <div
            ref={dropdownRef}
            className="fixed rounded border shadow-xl overflow-hidden min-w-[200px] max-h-[300px] overflow-y-auto"
            style={{
              top: dropdownPos.top,
              left: dropdownPos.left,
              zIndex: 9999,
              background: "hsl(220 13% 16%)",
              borderColor: "hsl(220 13% 28%)",
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            }}
          >
            {sorted.map((node) => {
              const isCurrent = node.name === label;
              return (
                <button
                  key={node.id}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
                  style={{
                    color: isCurrent ? "hsl(207 90% 65%)" : "hsl(220 14% 80%)",
                    background: isCurrent ? "hsl(207 90% 40% / 0.15)" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "hsl(220 13% 24%)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      isCurrent ? "hsl(207 90% 40% / 0.15)" : "transparent";
                  }}
                  onClick={() => {
                    setOpen(false);
                    if (node.type === "file" && onSelectFile) {
                      onSelectFile(node);
                    }
                  }}
                >
                  {getSmallIcon(node.name, node.type)}
                  <span className="truncate">{node.name}</span>
                  {isCurrent && (
                    <span className="ml-auto text-[10px]" style={{ color: "hsl(220 14% 45%)" }}>
                      current
                    </span>
                  )}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}

interface BreadcrumbBarProps {
  filePath: string;
  allFiles: FileNode[];
  onSelectFile?: (node: FileNode) => void;
}

function BreadcrumbBar({ filePath, allFiles, onSelectFile }: BreadcrumbBarProps) {
  const parts = filePath.split("/");

  return (
    <div
      className="flex items-center gap-0 px-2 overflow-x-auto"
      style={{
        height: 24,
        minHeight: 24,
        background: "hsl(220 13% 18%)",
        borderBottom: "1px solid hsl(220 13% 24%)",
      }}
      data-testid="editor-breadcrumb"
    >
      {parts.map((part, i) => {
        const siblings = findSiblings(allFiles, parts, i);
        const isLast = i === parts.length - 1;

        return (
          <BreadcrumbSegment
            key={`${part}-${i}`}
            label={part}
            isLast={isLast}
            siblings={siblings}
            onSelectFile={onSelectFile}
          />
        );
      })}
    </div>
  );
}

// ── Editor Area ──

export function EditorArea({
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
  onContentChange,
  allFiles = [],
  onSelectFile,
  onOpenPreview,
  projectType = "static",
}: EditorAreaProps) {
  const editorRef = useRef<unknown>(null);
  const [editorMounted, setEditorMounted] = useState(false);
  const changeTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const { get: getSetting } = useSettings();
  const { activeProjectId } = useActiveProject();

  const activeTab = tabs.find((t) => t.node.id === activeTabId);

  const monacoRef = useRef<any>(null);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setEditorMounted(true);

    // Configure TypeScript with proper module resolution
    const tsDefaults = monaco.languages.typescript.typescriptDefaults;
    const jsDefaults = monaco.languages.typescript.javascriptDefaults;

    const compilerOptions: any = {
      target: monaco.languages.typescript.ScriptTarget.Latest,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      allowJs: true,
      checkJs: false,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      strict: false,
      noEmit: true,
      skipLibCheck: true,
      baseUrl: ".",
      paths: { "@/*": ["src/*"] },
    };

    tsDefaults.setCompilerOptions(compilerOptions);
    jsDefaults.setCompilerOptions(compilerOptions);

    // Enable semantic validation but suppress some noise
    tsDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: [
        2307, // Cannot find module
        2304, // Cannot find name
        7016, // Could not find declaration file
        2792, // Cannot find module (moduleResolution)
        1259, // Module can only be default-imported
        2686, // UMD global reference
        1375, // await at top level
        2345, // Argument type not assignable
        2322, // Type not assignable
        2875, // JSX tag requires module path 'react/jsx-runtime'
        2503, // Cannot find namespace
        2694, // Namespace has no exported member
        2695, // Left side of comma operator is unused
        1005, // ';' expected (JSX)
        1382, // Unused directive
        6133, // Declared but never read
        2339, // Property does not exist on type (too noisy without full types)
      ],
    });
    jsDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: [2307, 2304, 7016, 2792, 1259, 2686, 1375, 8006, 8010, 2875, 2503, 6133],
    });

    // Enable eager model sync for Ctrl+Click navigation
    tsDefaults.setEagerModelSync(true);
    jsDefaults.setEagerModelSync(true);

    // Add essential global type stubs
    tsDefaults.addExtraLib(`
declare module "react/jsx-runtime" { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module "react/jsx-dev-runtime" { export const jsxDEV: any; export const Fragment: any; }
declare namespace NodeJS {
  type Timeout = ReturnType<typeof setTimeout>;
  type Timer = ReturnType<typeof setTimeout>;
  type Immediate = ReturnType<typeof setImmediate>;
  interface ProcessEnv { [key: string]: string | undefined; NODE_ENV: string; }
  interface Process { env: ProcessEnv; cwd(): string; argv: string[]; platform: string; exit(code?: number): never; }
  interface ReadableStream { read(): any; on(event: string, listener: Function): this; pipe(dest: any): any; }
  interface WritableStream { write(data: any): boolean; end(): void; on(event: string, listener: Function): this; }
  interface EventEmitter { on(event: string, listener: Function): this; emit(event: string, ...args: any[]): boolean; removeListener(event: string, listener: Function): this; }
}
declare var process: NodeJS.Process;
declare var __dirname: string;
declare var __filename: string;
declare var Buffer: { from(data: any, encoding?: string): any; alloc(size: number): any; isBuffer(obj: any): boolean; };
declare function require(module: string): any;
declare var module: { exports: any };
declare var exports: any;
declare module "*.css" { const content: Record<string, string>; export default content; }
declare module "*.module.css" { const content: Record<string, string>; export default content; }
declare module "*.svg" { const content: any; export default content; }
declare module "*.png" { const content: string; export default content; }
declare module "*.jpg" { const content: string; export default content; }
declare module "*.gif" { const content: string; export default content; }
declare module "*.webp" { const content: string; export default content; }
declare module "*.json" { const content: any; export default content; }
declare module "*.woff" { const content: string; export default content; }
declare module "*.woff2" { const content: string; export default content; }
`, "file:///global.d.ts");

    // Register inline AI completion provider (Copilot-like ghost text)
    try {
      const aiDisposable = registerInlineAI(monaco);
      // Store on editor for cleanup if needed
      (editor as any).__pipilotInlineAI = aiDisposable;
    } catch (err) {
      console.warn("Inline AI registration failed:", err);
    }
  };

  // Register all project files as Monaco models for Ctrl+Click navigation
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !allFiles?.length) return;

    function walkAndRegister(nodes: FileNode[]) {
      for (const node of nodes) {
        if (node.type === "file" && node.content != null) {
          const ext = node.name.split(".").pop()?.toLowerCase() || "";
          const langMap: Record<string, string> = {
            ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
            json: "json", css: "css", html: "html", md: "markdown", svg: "xml",
          };
          const lang = langMap[ext] || "plaintext";
          const uri = monaco.Uri.parse(`file:///${node.id}`);

          // Only create model if it doesn't exist yet
          if (!monaco.editor.getModel(uri)) {
            monaco.editor.createModel(node.content, lang, uri);
          } else {
            // Update content if changed
            const model = monaco.editor.getModel(uri);
            if (model && model.getValue() !== node.content) {
              model.setValue(node.content);
            }
          }
        }
        if (node.children) walkAndRegister(node.children);
      }
    }

    walkAndRegister(allFiles);
  }, [allFiles]);

  // Auto-fetch type definitions from the workspace's node_modules via our API
  const fetchedTypesRef = useRef(new Set<string>());
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !allFiles?.length || !projectType) return;

    // Find package.json in the file tree
    function findPackageJson(nodes: FileNode[]): string | null {
      for (const node of nodes) {
        if (node.name === "package.json" && node.content) return node.content;
        if (node.children) {
          const found = findPackageJson(node.children);
          if (found) return found;
        }
      }
      return null;
    }

    const pkgContent = findPackageJson(allFiles);
    if (!pkgContent) return;

    let deps: string[] = [];
    try {
      const pkg = JSON.parse(pkgContent);
      deps = [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
      ];
    } catch { return; }

    const tsDefaults = monaco.languages.typescript.typescriptDefaults;

    for (const dep of deps) {
      if (fetchedTypesRef.current.has(dep)) continue;
      fetchedTypesRef.current.add(dep);

      // Fetch type definitions from the workspace's node_modules
      fetch(`/api/files/types?projectId=${encodeURIComponent(activeProjectId)}&package=${encodeURIComponent(dep)}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (!data?.files) return;
          // Register all .d.ts files as extra libs
          for (const [filePath, content] of Object.entries(data.files)) {
            if (typeof content === "string") {
              const libPath = `file:///node_modules/${dep}/${filePath}`;
              tsDefaults.addExtraLib(content, libPath);
            }
          }
        })
        .catch(() => {
          // Fallback to CDN if workspace node_modules don't have types
          const typePkg = `@types/${dep.replace("@", "").replace("/", "__")}`;
          fetch(`https://cdn.jsdelivr.net/npm/${typePkg}/index.d.ts`)
            .then(r => r.ok ? r.text() : null)
            .then(dts => {
              if (dts) tsDefaults.addExtraLib(dts, `file:///node_modules/${dep}/index.d.ts`);
            })
            .catch(() => {});
        });
    }
  }, [allFiles, projectType, activeProjectId]);

  useEffect(() => {
    if (editorMounted && editorRef.current) {
      const editor = editorRef.current as {
        getModel: () => { getValue: () => string; setValue: (v: string) => void } | null;
      };
      if (activeTab?.node.content !== undefined) {
        const model = editor.getModel();
        if (model) {
          const currentValue = model.getValue();
          if (currentValue !== activeTab.node.content) {
            model.setValue(activeTab.node.content);
          }
        }
      }
    }
  }, [activeTabId, editorMounted, activeTab?.node.content]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!value || !activeTabId || !onContentChange) return;
      if (changeTimeoutRef.current) clearTimeout(changeTimeoutRef.current);
      changeTimeoutRef.current = setTimeout(() => {
        onContentChange(activeTabId, value);
      }, 500);
    },
    [activeTabId, onContentChange]
  );

  const getFileExt = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
  const getTabIcon = (name: string) => {
    const ext = getFileExt(name);
    switch (ext) {
      case "tsx": case "jsx":
        return <FileCode2 size={13} className="text-blue-400 flex-shrink-0" />;
      case "ts": case "js":
        return <FileCode2 size={13} className="text-yellow-400 flex-shrink-0" />;
      case "json":
        return <FileJson size={13} className="text-yellow-300 flex-shrink-0" />;
      case "css":
        return <FileType size={13} className="text-blue-400 flex-shrink-0" />;
      case "md":
        return <FileText size={13} className="text-blue-300 flex-shrink-0" />;
      default:
        return <FileText size={13} className="text-gray-400 flex-shrink-0" />;
    }
  };

  if (tabs.length === 0) {
    return (
      <div
        className="flex-1 flex flex-col items-center justify-center"
        style={{ background: "hsl(220 13% 18%)" }}
        data-testid="editor-empty-state"
      >
        <div className="text-center" style={{ color: "hsl(220 14% 40%)" }}>
          <div className="text-4xl mb-2 font-light" style={{ color: "hsl(207 90% 50% / 0.4)" }}>
            PiPilot
          </div>
          <p className="text-sm mb-1">Open a file from the Explorer</p>
          <p className="text-xs opacity-70">Ctrl+P to search files</p>
          {onOpenPreview && (
            <button
              className="mt-4 flex items-center gap-2 mx-auto px-4 py-2 rounded-lg text-sm transition-colors"
              style={{
                background: "hsl(220 13% 24%)",
                color: "hsl(142 71% 60%)",
                border: "1px solid hsl(220 13% 30%)",
              }}
              onClick={onOpenPreview}
            >
              <Globe size={14} />
              Open Web Preview
            </button>
          )}
          <div className="mt-4 flex flex-col gap-1 text-xs opacity-50">
            <span>Ctrl+Shift+I — Toggle AI Chat</span>
            <span>Ctrl+` — Toggle Terminal</span>
            <span>Ctrl+B — Toggle Sidebar</span>
          </div>
        </div>
      </div>
    );
  }

  const isPreviewTab = activeTab?.isPreview;
  const isCommitTab = activeTab?.isCommit;
  const isDiffTab = activeTab?.isDiff;
  const isSettingsTab = activeTab?.isSettings;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" data-testid="editor-area">
      {/* Tab bar */}
      <div className="editor-tabs" data-testid="editor-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.node.id}
            className={`editor-tab ${activeTabId === tab.node.id ? "active" : ""}`}
            onClick={() => onActivateTab(tab.node.id)}
            data-testid={`editor-tab-${tab.node.id}`}
          >
            {tab.isPreview ? (
              <Globe size={13} className="text-green-400 flex-shrink-0" />
            ) : tab.isCommit ? (
              <GitCommit size={13} style={{ color: "hsl(207 90% 60%)" }} className="flex-shrink-0" />
            ) : tab.isDiff ? (
              <FileText size={13} style={{ color: "hsl(38 92% 60%)" }} className="flex-shrink-0" />
            ) : tab.isSettings ? (
              <Settings size={13} style={{ color: "hsl(220 14% 70%)" }} className="flex-shrink-0" />
            ) : (
              getTabIcon(tab.node.name)
            )}
            <span className="truncate flex-1">{tab.node.name}</span>
            <button
              className="close-btn"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.node.id);
              }}
              data-testid={`editor-tab-close-${tab.node.id}`}
            >
              {tab.isDirty ? (
                <Circle size={10} className="fill-current" />
              ) : (
                <X size={12} />
              )}
            </button>
          </div>
        ))}

        {/* Open Preview button */}
        {onOpenPreview && (
          <button
            className="flex items-center gap-1.5 px-3 text-xs transition-colors hover:bg-white/5"
            style={{ color: "hsl(220 14% 50%)", height: "100%", borderRight: "1px solid hsl(220 13% 22%)" }}
            onClick={onOpenPreview}
            title="Open Web Preview"
          >
            <Globe size={12} />
            <span>Preview</span>
          </button>
        )}
      </div>

      {/* Breadcrumb — only for file tabs */}
      {activeTab && !isPreviewTab && !isCommitTab && !isDiffTab && !isSettingsTab && (
        <BreadcrumbBar
          filePath={activeTab.node.id}
          allFiles={allFiles}
          onSelectFile={onSelectFile}
        />
      )}

      {/* Web Preview tab */}
      {isPreviewTab && (
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
          <div style={{ position: "absolute", inset: 0 }}>
            <WebPreview files={allFiles} projectType={projectType} />
          </div>
        </div>
      )}

      {/* Commit detail tab */}
      {isCommitTab && activeTab?.commitOid && activeProjectId && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          <CommitDetailView projectId={activeProjectId} oid={activeTab.commitOid} />
        </div>
      )}

      {/* File diff tab */}
      {isDiffTab && activeTab?.diffPath && activeProjectId && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          <FileDiffView
            projectId={activeProjectId}
            filePath={activeTab.diffPath}
            staged={activeTab.diffStaged ?? false}
          />
        </div>
      )}

      {/* Settings tab */}
      {isSettingsTab && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
          <SettingsTabView />
        </div>
      )}

      {/* Monaco Editor — for file tabs */}
      {!isPreviewTab && !isCommitTab && !isDiffTab && !isSettingsTab && (
        <div className="flex-1 overflow-hidden" data-testid="monaco-editor">
          {activeTab && (
            <Editor
              key={activeTab.node.id}
              height="100%"
              language={activeTab.node.language ?? "plaintext"}
              path={`file:///${activeTab.node.id}`}
              defaultValue={activeTab.node.content ?? ""}
              theme="vs-dark"
              onMount={handleMount}
              onChange={handleEditorChange}
              options={{
                fontSize: parseInt(getSetting("editorFontSize")) || 14,
                fontFamily: getSetting("editorFontFamily") || "'Cascadia Code', 'Fira Code', 'Menlo', monospace",
                fontLigatures: true,
                lineNumbers: "on",
                minimap: { enabled: getSetting("editorMinimap") === "true", scale: 1 },
                scrollBeyondLastLine: false,
                wordWrap: getSetting("editorWordWrap") === "on" ? "on" : "off",
                tabSize: parseInt(getSetting("editorTabSize")) || 2,
                insertSpaces: true,
                automaticLayout: true,
                cursorBlinking: "smooth",
                smoothScrolling: true,
                renderWhitespace: "selection",
                bracketPairColorization: { enabled: true },
                padding: { top: 8, bottom: 8 },
                scrollbar: {
                  vertical: "auto",
                  horizontal: "auto",
                  verticalScrollbarSize: 8,
                  horizontalScrollbarSize: 8,
                },
                // AI inline completions (Copilot-like ghost text)
                inlineSuggest: {
                  enabled: true,
                  mode: "subwordSmart",
                  showToolbar: "onHover",
                },
                suggest: {
                  preview: true,
                  showInlineDetails: true,
                },
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
