import { FileNode, SAMPLE_PROJECT } from "@/data/sampleFiles";
import { FileTree } from "./FileTree";
import { ActivityBarView } from "./ActivityBar";
import { Search, GitBranch, Package, Bug, ChevronDown } from "lucide-react";

interface SidebarPanelProps {
  view: ActivityBarView | null;
  selectedFileId: string | null;
  onSelectFile: (node: FileNode) => void;
}

export function SidebarPanel({ view, selectedFileId, onSelectFile }: SidebarPanelProps) {
  if (!view) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="sidebar-panel">
      {view === "explorer" && (
        <>
          <div
            className="flex items-center justify-between px-4 py-2 text-xs font-semibold tracking-widest uppercase"
            style={{ color: "hsl(220 14% 60%)" }}
          >
            <span>Explorer</span>
          </div>
          <div className="border-b" style={{ borderColor: "hsl(220 13% 22%)" }}>
            <div
              className="flex items-center gap-1 px-2 py-1 text-xs font-semibold cursor-pointer select-none"
              style={{ color: "hsl(220 14% 75%)" }}
            >
              <ChevronDown size={12} />
              <span>MY-REACT-APP</span>
            </div>
            <div className="pb-2 overflow-y-auto" style={{ maxHeight: "calc(100vh - 130px)" }}>
              <FileTree
                nodes={SAMPLE_PROJECT}
                selectedFileId={selectedFileId}
                onSelectFile={onSelectFile}
              />
            </div>
          </div>
        </>
      )}

      {view === "search" && (
        <div className="flex flex-col gap-2 p-3">
          <div
            className="text-xs font-semibold tracking-widest uppercase px-1 mb-1"
            style={{ color: "hsl(220 14% 60%)" }}
          >
            Search
          </div>
          <div className="flex items-center gap-2 rounded px-2 py-1" style={{ background: "hsl(220 13% 22%)" }}>
            <Search size={12} style={{ color: "hsl(220 14% 55%)" }} />
            <input
              className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground"
              placeholder="Search"
              data-testid="search-input"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2 px-1">
            Type to search across files
          </p>
        </div>
      )}

      {view === "source-control" && (
        <div className="flex flex-col p-3">
          <div className="flex items-center gap-2 mb-3">
            <GitBranch size={14} style={{ color: "hsl(220 14% 60%)" }} />
            <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "hsl(220 14% 60%)" }}>
              Source Control
            </span>
          </div>
          <div className="text-xs text-muted-foreground px-1">
            <p className="mb-2">No active repository.</p>
            <p>Initialize a git repository to track changes.</p>
          </div>
        </div>
      )}

      {view === "debug" && (
        <div className="flex flex-col p-3">
          <div className="flex items-center gap-2 mb-3">
            <Bug size={14} style={{ color: "hsl(220 14% 60%)" }} />
            <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "hsl(220 14% 60%)" }}>
              Run and Debug
            </span>
          </div>
          <div className="text-xs text-muted-foreground px-1">
            <p className="mb-2">No configuration found.</p>
            <p>Create a launch configuration to debug your app.</p>
          </div>
        </div>
      )}

      {view === "extensions" && (
        <div className="flex flex-col p-3">
          <div className="flex items-center gap-2 mb-3">
            <Package size={14} style={{ color: "hsl(220 14% 60%)" }} />
            <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: "hsl(220 14% 60%)" }}>
              Extensions
            </span>
          </div>
          <div className="flex items-center gap-2 rounded px-2 py-1 mb-2" style={{ background: "hsl(220 13% 22%)" }}>
            <Search size={12} style={{ color: "hsl(220 14% 55%)" }} />
            <input
              className="bg-transparent text-xs outline-none w-full placeholder:text-muted-foreground"
              placeholder="Search extensions"
            />
          </div>
          <div className="text-xs text-muted-foreground px-1">
            <p>Discover extensions to enhance your workflow.</p>
          </div>
        </div>
      )}
    </div>
  );
}
