export interface Tool {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'file_ops' | 'code_search' | 'web' | 'dev' | 'project' | 'pipilot_db' | 'docs' | 'special';
}

export const availableTools: Tool[] = [
  // ── Core File Operations ──
  {
    id: 'read_file',
    name: 'Read File',
    description: 'Read contents of a file (up to 500 lines with ranges)',
    icon: 'FileText',
    category: 'file_ops',
  },
  {
    id: 'write_file',
    name: 'Write File',
    description: 'Create or update a file in the project',
    icon: 'FilePlus',
    category: 'file_ops',
  },
  {
    id: 'edit_file',
    name: 'Edit File',
    description: 'Edit an existing file using search/replace or full rewrite',
    icon: 'FileEdit',
    category: 'file_ops',
  },
  {
    id: 'delete_file',
    name: 'Delete File',
    description: 'Remove a file or directory (recursive)',
    icon: 'Trash2',
    category: 'file_ops',
  },
  {
    id: 'list_files',
    name: 'List Files',
    description: 'List files and directories (up to 200 items)',
    icon: 'FolderTree',
    category: 'file_ops',
  },
  // ── Power File Operations ──
  {
    id: 'batch_create_files',
    name: 'Batch Create',
    description: 'Create multiple files at once for fast scaffolding',
    icon: 'Files',
    category: 'file_ops',
  },
  {
    id: 'rename_file',
    name: 'Rename / Move',
    description: 'Rename or move a file or folder to a new path',
    icon: 'FileSymlink',
    category: 'file_ops',
  },
  {
    id: 'copy_file',
    name: 'Copy File',
    description: 'Duplicate a file to a new location',
    icon: 'Copy',
    category: 'file_ops',
  },
  {
    id: 'get_project_tree',
    name: 'Project Tree',
    description: 'Visual tree view of the entire project with line counts',
    icon: 'Network',
    category: 'file_ops',
  },
  // ── Search ──
  {
    id: 'search_files',
    name: 'Search Files',
    description: 'Search files by name or content (up to 50 results)',
    icon: 'Search',
    category: 'code_search',
  },
  {
    id: 'get_file_info',
    name: 'File Info',
    description: 'Get detailed file metadata (size, lines, dates)',
    icon: 'Info',
    category: 'code_search',
  },
  // ── Project ──
  {
    id: 'generate_plan',
    name: 'Generate Plan',
    description: 'Create a structured execution plan for building',
    icon: 'Map',
    category: 'project',
  },
  {
    id: 'update_plan_progress',
    name: 'Update Plan',
    description: 'Mark plan steps as completed',
    icon: 'CheckSquare',
    category: 'project',
  },
  {
    id: 'update_project_context',
    name: 'Update Context',
    description: 'Update project metadata and roadmap',
    icon: 'RefreshCw',
    category: 'project',
  },
  {
    id: 'start_build_mode',
    name: 'Start Build',
    description: 'Enter build mode for rapid implementation',
    icon: 'Play',
    category: 'project',
  },
  {
    id: 'finish_build_mode',
    name: 'Finish Build',
    description: 'Exit build mode and return to summary',
    icon: 'StopCircle',
    category: 'project',
  },
  // ── Development ──
  {
    id: 'frontend_design_guide',
    name: 'Design Guide',
    description: 'Generate or read the design system',
    icon: 'Palette',
    category: 'dev',
  },
  {
    id: 'project_file_strategy',
    name: 'File Strategy',
    description: 'Get optimized file structure recommendations',
    icon: 'Layout',
    category: 'dev',
  },
  // ── Vision ──
  {
    id: 'screenshot_preview',
    name: 'Screenshot Preview',
    description: 'Capture a visual screenshot of the web preview to see the UI',
    icon: 'Camera',
    category: 'dev',
  },
  // ── Browser Interaction ──
  {
    id: 'preview_click',
    name: 'Click Element',
    description: 'Click an element in the preview by selector or coordinates',
    icon: 'MousePointer',
    category: 'dev',
  },
  {
    id: 'preview_scroll',
    name: 'Scroll Preview',
    description: 'Scroll the preview page up, down, left, or right',
    icon: 'ArrowDownUp',
    category: 'dev',
  },
  {
    id: 'preview_type',
    name: 'Type Text',
    description: 'Type text into an input or textarea in the preview',
    icon: 'Keyboard',
    category: 'dev',
  },
  {
    id: 'preview_find_elements',
    name: 'Find Elements',
    description: 'Find all interactive elements (buttons, links, inputs) in the preview',
    icon: 'ScanSearch',
    category: 'dev',
  },
  // ── Execution ──
  {
    id: 'run_script',
    name: 'Run Script',
    description: 'Execute JavaScript/Node.js code and return the output',
    icon: 'Play',
    category: 'dev',
  },
  // ── Deployment ──
  {
    id: 'deploy_site',
    name: 'Deploy Site',
    description: 'Deploy the project to a live public URL',
    icon: 'Globe',
    category: 'web',
  },
  // ── Special ──
  {
    id: 'discover_tools',
    name: 'Discover Tools',
    description: 'Search for available tools by keyword',
    icon: 'Search',
    category: 'special',
  },
];

export const toolsByCategory = availableTools.reduce((acc, tool) => {
  if (!acc[tool.category]) {
    acc[tool.category] = [];
  }
  acc[tool.category].push(tool);
  return acc;
}, {} as Record<string, Tool[]>);

export const categoryLabels: Record<string, string> = {
  file_ops: 'File Operations',
  code_search: 'Code Search',
  web: 'Web',
  dev: 'Development',
  project: 'Project',
  pipilot_db: 'PiPilot DB',
  docs: 'Documentation',
  special: 'Special',
};
