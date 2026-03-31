import { useEffect, useRef, useState } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import { X, Circle } from "lucide-react";
import { FileNode } from "@/data/sampleFiles";

export interface EditorTab {
  node: FileNode;
  isDirty: boolean;
}

interface EditorAreaProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  onActivateTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export function EditorArea({
  tabs,
  activeTabId,
  onActivateTab,
  onCloseTab,
}: EditorAreaProps) {
  const editorRef = useRef<unknown>(null);
  const [editorMounted, setEditorMounted] = useState(false);

  const activeTab = tabs.find((t) => t.node.id === activeTabId);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    setEditorMounted(true);
  };

  useEffect(() => {
    if (editorMounted && editorRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const editor = editorRef.current as any;
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
  }, [activeTabId, editorMounted, activeTab]);

  const getFileExt = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
  const getTabLabel = (name: string) => {
    const ext = getFileExt(name);
    switch (ext) {
      case "tsx":
      case "jsx":
        return "⚛";
      case "ts":
      case "js":
        return "JS";
      case "json":
        return "{}";
      case "md":
        return "MD";
      case "css":
        return "CSS";
      default:
        return "";
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
          <div className="text-4xl mb-4 font-light">AI IDE</div>
          <p className="text-sm mb-1">Open a file from the Explorer</p>
          <p className="text-xs opacity-70">or press Ctrl+P to search files</p>
        </div>
      </div>
    );
  }

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
            <span className="text-xs opacity-50">{getTabLabel(tab.node.name)}</span>
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
      </div>

      {/* Breadcrumb */}
      {activeTab && (
        <div className="breadcrumb" data-testid="editor-breadcrumb">
          {activeTab.node.id
            .split("/")
            .map((part, i, arr) => (
              <span key={i}>
                <span style={{ color: i === arr.length - 1 ? "hsl(220 14% 80%)" : undefined }}>
                  {part}
                </span>
                {i < arr.length - 1 && (
                  <span className="mx-1 opacity-40">›</span>
                )}
              </span>
            ))}
        </div>
      )}

      {/* Monaco Editor */}
      <div className="flex-1 overflow-hidden" data-testid="monaco-editor">
        {activeTab && (
          <Editor
            key={activeTab.node.id}
            height="100%"
            defaultLanguage={activeTab.node.language ?? "plaintext"}
            defaultValue={activeTab.node.content ?? ""}
            theme="vs-dark"
            onMount={handleMount}
            options={{
              fontSize: 13,
              fontFamily: "'Cascadia Code', 'Fira Code', 'Menlo', monospace",
              fontLigatures: true,
              lineNumbers: "on",
              minimap: { enabled: true, scale: 1 },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              tabSize: 2,
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
            }}
          />
        )}
      </div>
    </div>
  );
}
