export interface Tool {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'file_ops' | 'code_search' | 'web' | 'dev' | 'project' | 'pipilot_db' | 'docs' | 'special';
}

export const availableTools: Tool[] = [
  {
    id: 'read_file',
    name: 'Read File',
    description: 'Read contents of a file from the project',
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
    description: 'Edit an existing file using search/replace',
    icon: 'FileEdit',
    category: 'file_ops',
  },
  {
    id: 'delete_file',
    name: 'Delete File',
    description: 'Remove a file from the project',
    icon: 'Trash2',
    category: 'file_ops',
  },
  {
    id: 'list_files',
    name: 'List Files',
    description: 'List all files and directories in the project',
    icon: 'FolderTree',
    category: 'file_ops',
  },
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
  {
    id: 'discover_tools',
    name: 'Discover Tools',
    description: 'Search for available tools by keyword',
    icon: 'Search',
    category: 'special',
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
