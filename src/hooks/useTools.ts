import { useState, useCallback } from "react";
import { Tool } from "@/components/tools/ToolsPanel";

export type ActivityBarView = "explorer" | "search" | "source-control" | "debug" | "extensions" | "tools";

interface UseToolsReturn {
  selectedTool: Tool | null;
  toolsSearchQuery: string;
  selectTool: (tool: Tool | null) => void;
  setToolsSearchQuery: (query: string) => void;
}

export function useTools(): UseToolsReturn {
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [toolsSearchQuery, setToolsSearchQuery] = useState("");

  const selectTool = useCallback((tool: Tool | null) => {
    setSelectedTool(tool);
  }, []);

  return {
    selectedTool,
    toolsSearchQuery,
    selectTool,
    setToolsSearchQuery,
  };
}
