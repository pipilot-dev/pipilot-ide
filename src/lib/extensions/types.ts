// ─── Extension Manifest ─────────────────────────────────────────────

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon: string; // lucide icon name
  main: string; // entry point filename
  activationEvents: string[]; // ["*", "onCommand:x", "onLanguage:py"]
  contributes: ExtensionContributions;
  categories?: string[];
  tags?: string[];
  readme?: string;
  featured?: boolean;
  repository?: string;
  license?: string;
}

export interface ExtensionContributions {
  activityBarItems?: ActivityBarContribution[];
  sidebarPanels?: SidebarPanelContribution[];
  statusBarItems?: StatusBarContribution[];
  commands?: CommandContribution[];
  chatCommands?: ChatCommandContribution[];
  contextMenuItems?: ContextMenuContribution[];
  terminalCommands?: TerminalCommandContribution[];
  keybindings?: KeybindingContribution[];
  settings?: SettingContribution[];
  languages?: LanguageContribution[];
}

export interface ActivityBarContribution {
  id: string;
  icon: string;
  title: string;
  priority?: number;
}

export interface SidebarPanelContribution {
  id: string;
  title: string;
}

export interface StatusBarContribution {
  id: string;
  text: string;
  icon?: string;
  tooltip?: string;
  alignment: "left" | "right";
  priority?: number;
  command?: string;
}

export interface CommandContribution {
  id: string;
  title: string;
  icon?: string;
  keybinding?: string;
  category?: string;
}

export interface ChatCommandContribution {
  name: string;
  description: string;
  parameters?: { name: string; description: string; required?: boolean }[];
}

export interface ContextMenuContribution {
  id: string;
  label: string;
  command: string;
  when?: string;
  group?: string;
}

export interface TerminalCommandContribution {
  name: string;
  description: string;
  command: string;
}

export interface KeybindingContribution {
  command: string;
  key: string;
  when?: string;
}

export interface SettingContribution {
  id: string;
  title: string;
  description: string;
  type: "string" | "boolean" | "number" | "select";
  default: unknown;
  options?: { label: string; value: string }[];
}

export interface LanguageContribution {
  id: string;
  extensions: string[];
  aliases?: string[];
  configuration?: {
    comments?: { lineComment?: string; blockComment?: [string, string] };
    brackets?: [string, string][];
    autoClosingPairs?: { open: string; close: string }[];
  };
}

// ─── Runtime Types ──────────────────────────────────────────────────

export interface Disposable {
  dispose(): void;
}

export interface StatusBarItemRuntime {
  id: string;
  extensionId: string;
  text: string;
  icon?: string;
  tooltip?: string;
  alignment: "left" | "right";
  priority: number;
  onClick?: () => void;
}

export interface CommandRegistration {
  id: string;
  extensionId: string;
  title: string;
  icon?: string;
  category?: string;
  handler: (...args: unknown[]) => unknown;
}

export interface SidebarPanelRuntime {
  id: string;
  extensionId: string;
  title: string;
  renderFn?: (container: HTMLElement) => void | (() => void);
}

export interface ChatCommandRuntime {
  name: string;
  extensionId: string;
  description: string;
  handler: (args: string) => Promise<string>;
}

export interface TerminalCommandRuntime {
  name: string;
  extensionId: string;
  description: string;
  handler: (args: string[]) => Promise<string>;
}

export interface ContextMenuRuntime {
  id: string;
  extensionId: string;
  label: string;
  command: string;
  when?: string;
  group?: string;
}

// ─── DB Types ───────────────────────────────────────────────────────

export interface DBExtension {
  id: string;
  manifest: string; // JSON-serialized ExtensionManifest
  code: string;
  enabled: boolean;
  installedAt: Date;
  updatedAt: Date;
  source: "builtin" | "marketplace" | "local";
}

export interface DBExtensionState {
  extensionId: string;
  key: string;
  value: string; // JSON-serialized
}

// ─── Extension Bundle (for marketplace) ─────────────────────────────

export interface ExtensionBundle {
  manifest: ExtensionManifest;
  code: string;
}

export interface RegistryEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon: string;
  categories?: string[];
  tags?: string[];
  downloadCount?: number;
  rating?: number;
  bundleUrl?: string;
  featured?: boolean;
}

// ─── Extension API Types ────────────────────────────────────────────

export interface FileChangeEvent {
  type: "create" | "edit" | "delete";
  path: string;
}

export interface PiPilotExtensionAPI {
  workspace: {
    files: {
      read(path: string): Promise<string>;
      list(path: string): Promise<{ name: string; type: "file" | "folder" }[]>;
      create(path: string, content: string): Promise<void>;
      edit(path: string, search: string, replace: string): Promise<void>;
      delete(path: string): Promise<void>;
      exists(path: string): Promise<boolean>;
    };
    onFileChange(callback: (event: FileChangeEvent) => void): Disposable;
    getProjectId(): string;
    getProjectName(): string;
  };
  editor: {
    getActiveFile(): { path: string; content: string; language: string } | null;
    onActiveFileChange(callback: (file: { path: string } | null) => void): Disposable;
  };
  ui: {
    addStatusBarItem(item: Omit<StatusBarItemRuntime, "extensionId">): Disposable;
    updateStatusBarItem(id: string, updates: Partial<StatusBarItemRuntime>): void;
    addActivityBarItem(item: Omit<ActivityBarContribution, "id"> & { id: string }): Disposable;
    showNotification(config: { title: string; message: string; type?: "info" | "error" | "success" | "warning" }): void;
    registerSidebarPanel(id: string, renderFn: (container: HTMLElement) => void | (() => void)): Disposable;
  };
  commands: {
    register(id: string, handler: (...args: unknown[]) => unknown): Disposable;
    execute(id: string, ...args: unknown[]): Promise<unknown>;
    getAll(): { id: string; title: string }[];
  };
  chat: {
    addSlashCommand(config: { name: string; description: string; handler: (args: string) => Promise<string> }): Disposable;
  };
  terminal: {
    registerCommand(name: string, handler: (args: string[]) => Promise<string>): Disposable;
  };
  state: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
}
