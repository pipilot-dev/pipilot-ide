import { 
  FileText, FilePlus, FileEdit, Trash2, FolderTree, 
  Map, CheckSquare, Palette, Layout, Search, RefreshCw,
  Play, StopCircle, Database, Book, Code, Globe, Wrench,
  ChevronRight, ChevronDown, Plug
} from "lucide-react";
import { Tool, categoryLabels } from "@/data/tools";

const iconMap: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  FileText, FilePlus, FileEdit, Trash2, FolderTree,
  Map, CheckSquare, Palette, Layout, Search, RefreshCw,
  Play, StopCircle, Database, Book, Code, Globe, Wrench, Plug
};

interface ToolCardProps {
  tool: Tool;
  onClick?: (tool: Tool) => void;
}

export function ToolCard({ tool, onClick }: ToolCardProps) {
  const Icon = iconMap[tool.icon] || Code;
  
  return (
    <button
      onClick={() => onClick?.(tool)}
      className="w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors hover:bg-white/5 group"
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-white/10 group-hover:bg-white/15 transition-colors">
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-white/90 group-hover:text-white truncate">
          {tool.name}
        </p>
        <p className="text-[10px] text-white/40 mt-0.5 line-clamp-2">
          {tool.description}
        </p>
      </div>
    </button>
  );
}

interface ToolsPanelProps {
  searchQuery?: string;
  selectedToolId?: string | null;
  onSelectTool?: (tool: Tool) => void;
}

export function ToolsPanel({ searchQuery = "", selectedToolId, onSelectTool }: ToolsPanelProps) {
  const { availableTools, toolsByCategory, categoryLabels } = require("@/data/tools");
  
  const filteredTools = searchQuery
    ? availableTools.filter(
        (t: Tool) =>
          t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          t.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : availableTools;

  const groupedTools = filteredTools.reduce((acc: Record<string, Tool[]>, tool: Tool) => {
    if (!acc[tool.category]) acc[tool.category] = [];
    acc[tool.category].push(tool);
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="tools-panel">
      <div className="px-4 py-3 border-b" style={{ borderColor: "hsl(220 13% 22%)" }}>
        <div className="flex items-center gap-2">
          <Plug size={14} style={{ color: "hsl(220 14% 60%)" }} />
          <span 
            className="text-xs font-semibold tracking-widest uppercase"
            style={{ color: "hsl(220 14% 60%)" }}
          >
            Tools
          </span>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        {Object.entries(groupedTools).map(([category, tools]) => (
          <div key={category} className="mb-4">
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              {category === "file_ops" && <FolderTree size={11} style={{ color: "hsl(220 14% 45%)" }} />}
              {category === "dev" && <Wrench size={11} style={{ color: "hsl(220 14% 45%)" }} />}
              {category === "project" && <Map size={11} style={{ color: "hsl(220 14% 45%)" }} />}
              {category === "special" && <Search size={11} style={{ color: "hsl(220 14% 45%)" }} />}
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "hsl(220 14% 45%)" }}>
                {categoryLabels[category] || category}
              </span>
            </div>
            <div className="space-y-0.5">
              {(tools as Tool[]).map((tool) => (
                <div
                  key={tool.id}
                  className={`rounded-md transition-colors ${
                    selectedToolId === tool.id 
                      ? "bg-white/10" 
                      : "hover:bg-white/5"
                  }`}
                >
                  <ToolCard tool={tool} onClick={onSelectTool} />
                </div>
              ))}
            </div>
          </div>
        ))}
        
        {filteredTools.length === 0 && (
          <div className="text-center py-8 px-4">
            <p className="text-xs text-white/40">No tools found matching "{searchQuery}"</p>
          </div>
        )}
      </div>
    </div>
  );
}

export { categoryLabels } from "@/data/tools";
export type { Tool } from "@/data/tools";
