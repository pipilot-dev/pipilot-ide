import { db } from "@/lib/db";
import type { ExtensionHost } from "./ExtensionHost";
import type { PiPilotExtensionAPI, Disposable, StatusBarItemRuntime } from "./types";
import { fileOps } from "@/lib/db";

export function buildExtensionAPI(
  extensionId: string,
  host: ExtensionHost,
  services: {
    getActiveFile?: () => { path: string; content: string; language: string } | null;
    getProjectId?: () => string;
    getProjectName?: () => string;
    showNotification?: (config: { title: string; message: string; type?: string }) => void;
    fileChangeListeners?: Set<(event: { type: string; path: string }) => void>;
    activeFileChangeListeners?: Set<(file: { path: string } | null) => void>;
  }
): PiPilotExtensionAPI {
  const projectId = () => services.getProjectId?.() ?? "";

  const api: PiPilotExtensionAPI = {
    workspace: {
      files: {
        async read(path: string): Promise<string> {
          return fileOps.readFile(path, undefined, undefined, projectId());
        },
        async list(path: string): Promise<{ name: string; type: "file" | "folder" }[]> {
          const result = await fileOps.listFiles(path, undefined, projectId());
          return result.items.map((f) => ({ name: f.name, type: f.type }));
        },
        async create(path: string, content: string): Promise<void> {
          await fileOps.createFile(path, content, projectId());
        },
        async edit(path: string, search: string, replace: string): Promise<void> {
          await fileOps.editFile(path, search, replace, undefined, projectId());
        },
        async delete(path: string): Promise<void> {
          await fileOps.deleteFile(path, projectId());
        },
        async exists(path: string): Promise<boolean> {
          try {
            const file = await db.files.get(path);
            return !!file && file.projectId === projectId();
          } catch { return false; }
        },
      },
      onFileChange(callback: (event: { type: "create" | "edit" | "delete"; path: string }) => void): Disposable {
        const wrapped = callback as (event: { type: string; path: string }) => void;
        services.fileChangeListeners?.add(wrapped);
        return { dispose: () => { services.fileChangeListeners?.delete(wrapped); } };
      },
      getProjectId: () => services.getProjectId?.() ?? "",
      getProjectName: () => services.getProjectName?.() ?? "",
    },

    editor: {
      getActiveFile: () => services.getActiveFile?.() ?? null,
      onActiveFileChange(callback: (file: { path: string } | null) => void): Disposable {
        services.activeFileChangeListeners?.add(callback);
        return { dispose: () => { services.activeFileChangeListeners?.delete(callback); } };
      },
    },

    ui: {
      addStatusBarItem(item: Omit<StatusBarItemRuntime, "extensionId">): Disposable {
        return host.registerStatusBarItem(extensionId, { ...item, extensionId } as StatusBarItemRuntime);
      },
      updateStatusBarItem(id: string, updates: Partial<StatusBarItemRuntime>) {
        host.updateStatusBarItem(extensionId, id, updates);
      },
      addActivityBarItem(item) {
        return host.registerActivityBarItem(extensionId, item);
      },
      showNotification(config) {
        services.showNotification?.(config);
      },
      registerSidebarPanel(id, renderFn) {
        return host.registerSidebarPanel(extensionId, id, id, renderFn);
      },
    },

    commands: {
      register(id: string, handler: (...args: unknown[]) => unknown): Disposable {
        return host.registerCommand(extensionId, id, handler);
      },
      async execute(id: string, ...args: unknown[]): Promise<unknown> {
        return host.executeCommand(id, ...args);
      },
      getAll() {
        return host.getCommands().map((c) => ({ id: c.id, title: c.title }));
      },
    },

    chat: {
      addSlashCommand(config) {
        return host.registerChatCommand(extensionId, config);
      },
    },

    terminal: {
      registerCommand(name: string, handler: (args: string[]) => Promise<string>): Disposable {
        return host.registerTerminalCommand(extensionId, name, handler);
      },
    },

    state: {
      async get<T = unknown>(key: string): Promise<T | undefined> {
        const row = await db.extensionState.get([extensionId, key]);
        if (!row) return undefined;
        try { return JSON.parse(row.value) as T; } catch { return undefined; }
      },
      async set(key: string, value: unknown): Promise<void> {
        await db.extensionState.put({ extensionId, key, value: JSON.stringify(value) });
      },
      async delete(key: string): Promise<void> {
        await db.extensionState.delete([extensionId, key]);
      },
    },
  };

  return api;
}
