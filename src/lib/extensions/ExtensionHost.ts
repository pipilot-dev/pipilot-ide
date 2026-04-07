import { db } from "@/lib/db";
import type {
  ExtensionManifest, DBExtension, Disposable,
  StatusBarItemRuntime, CommandRegistration, SidebarPanelRuntime,
  ChatCommandRuntime, TerminalCommandRuntime, ContextMenuRuntime,
  ActivityBarContribution, ExtensionBundle,
} from "./types";
import { buildExtensionAPI } from "./ExtensionAPI";

interface LoadedExtension {
  id: string;
  manifest: ExtensionManifest;
  exports: { activate?: Function; deactivate?: Function };
  disposables: (() => void)[];
}

export class ExtensionHost {
  private extensions = new Map<string, LoadedExtension>();
  private _activityBarItems = new Map<string, ActivityBarContribution & { extensionId: string }>();
  private _statusBarItems = new Map<string, StatusBarItemRuntime>();
  private _commands = new Map<string, CommandRegistration>();
  private _sidebarPanels = new Map<string, SidebarPanelRuntime>();
  private _chatCommands = new Map<string, ChatCommandRuntime>();
  private _terminalCommands = new Map<string, TerminalCommandRuntime>();
  private _contextMenuItems = new Map<string, ContextMenuRuntime>();
  private listeners = new Set<() => void>();

  // IDE service references (set after mount)
  private _services: {
    getActiveFile?: () => { path: string; content: string; language: string } | null;
    getProjectId?: () => string;
    getProjectName?: () => string;
    showNotification?: (config: { title: string; message: string; type?: string }) => void;
    fileChangeListeners?: Set<(event: { type: string; path: string }) => void>;
    activeFileChangeListeners?: Set<(file: { path: string } | null) => void>;
  } = {};

  setServices(services: typeof this._services) {
    this._services = { ...this._services, ...services };
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async init() {
    const extensions = await db.extensions.where("enabled").equals(1).toArray();
    for (const ext of extensions) {
      try {
        await this.activateExtension(ext);
      } catch (err) {
        console.error(`[ExtensionHost] Failed to activate ${ext.id}:`, err);
      }
    }
  }

  private async activateExtension(dbExt: DBExtension) {
    const manifest: ExtensionManifest = JSON.parse(dbExt.manifest);

    // Register static contributions from manifest
    this.registerStaticContributions(manifest);

    // Load and execute extension code
    const api = buildExtensionAPI(manifest.id, this, this._services);
    let exports: { activate?: Function; deactivate?: Function } = {};

    try {
      const wrappedCode = `
        "use strict";
        return (function(pipilot) {
          var module = { exports: {} };
          var exports = module.exports;
          ${dbExt.code}
          return module.exports;
        })
      `;
      const factory = new Function(wrappedCode)();
      exports = factory(api) || {};
    } catch (err) {
      console.error(`[ExtensionHost] Code eval error for ${dbExt.id}:`, err);
    }

    const loaded: LoadedExtension = {
      id: dbExt.id,
      manifest,
      exports,
      disposables: [],
    };

    this.extensions.set(dbExt.id, loaded);

    // Call activate
    if (typeof exports.activate === "function") {
      try {
        await exports.activate(api);
      } catch (err) {
        console.error(`[ExtensionHost] activate() error for ${dbExt.id}:`, err);
      }
    }

    this.notify();
  }

  private registerStaticContributions(manifest: ExtensionManifest) {
    const c = manifest.contributes;
    if (!c) return;

    c.activityBarItems?.forEach((item) => {
      this._activityBarItems.set(`${manifest.id}.${item.id}`, { ...item, extensionId: manifest.id });
    });

    c.statusBarItems?.forEach((item) => {
      this._statusBarItems.set(`${manifest.id}.${item.id}`, {
        ...item, extensionId: manifest.id, priority: item.priority ?? 100,
      });
    });

    c.commands?.forEach((cmd) => {
      // Static commands registered in manifest need a handler to be provided by activate()
      // We'll register a placeholder that the extension's activate() can override
      if (!this._commands.has(cmd.id)) {
        this._commands.set(cmd.id, {
          ...cmd, extensionId: manifest.id,
          handler: () => console.warn(`Command ${cmd.id} not implemented`),
        });
      }
    });

    c.contextMenuItems?.forEach((item) => {
      this._contextMenuItems.set(`${manifest.id}.${item.id}`, { ...item, extensionId: manifest.id });
    });
  }

  // ─── Public registration methods (called by extension API) ──────────

  registerCommand(extensionId: string, id: string, handler: (...args: unknown[]) => unknown): Disposable {
    const existing = this._commands.get(id);
    this._commands.set(id, {
      id,
      extensionId,
      title: existing?.title ?? id,
      icon: existing?.icon,
      category: existing?.category,
      handler,
    });
    this.notify();
    return { dispose: () => { this._commands.delete(id); this.notify(); } };
  }

  registerStatusBarItem(extensionId: string, item: StatusBarItemRuntime): Disposable {
    const key = `${extensionId}.${item.id}`;
    this._statusBarItems.set(key, { ...item, extensionId });
    this.notify();
    return { dispose: () => { this._statusBarItems.delete(key); this.notify(); } };
  }

  updateStatusBarItem(extensionId: string, id: string, updates: Partial<StatusBarItemRuntime>) {
    const key = `${extensionId}.${id}`;
    const existing = this._statusBarItems.get(key);
    if (existing) {
      this._statusBarItems.set(key, { ...existing, ...updates });
      this.notify();
    }
  }

  registerActivityBarItem(extensionId: string, item: ActivityBarContribution): Disposable {
    const key = `${extensionId}.${item.id}`;
    this._activityBarItems.set(key, { ...item, extensionId });
    this.notify();
    return { dispose: () => { this._activityBarItems.delete(key); this.notify(); } };
  }

  registerSidebarPanel(extensionId: string, id: string, title: string, renderFn: (el: HTMLElement) => void | (() => void)): Disposable {
    const key = `${extensionId}.${id}`;
    this._sidebarPanels.set(key, { id: key, extensionId, title, renderFn });
    this.notify();
    return { dispose: () => { this._sidebarPanels.delete(key); this.notify(); } };
  }

  registerChatCommand(extensionId: string, config: { name: string; description: string; handler: (args: string) => Promise<string> }): Disposable {
    this._chatCommands.set(config.name, { ...config, extensionId });
    this.notify();
    return { dispose: () => { this._chatCommands.delete(config.name); this.notify(); } };
  }

  registerTerminalCommand(extensionId: string, name: string, handler: (args: string[]) => Promise<string>): Disposable {
    this._terminalCommands.set(name, { name, extensionId, description: "", handler });
    this.notify();
    return { dispose: () => { this._terminalCommands.delete(name); this.notify(); } };
  }

  async executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
    const cmd = this._commands.get(id);
    if (!cmd) throw new Error(`Command not found: ${id}`);
    return cmd.handler(...args);
  }

  // ─── Install / Uninstall ──────────────────────────────────────────

  async installExtension(bundle: ExtensionBundle, source: "builtin" | "marketplace" | "local" = "marketplace") {
    const dbExt: DBExtension = {
      id: bundle.manifest.id,
      manifest: JSON.stringify(bundle.manifest),
      code: bundle.code,
      enabled: true,
      installedAt: new Date(),
      updatedAt: new Date(),
      source,
    };
    await db.extensions.put(dbExt);
    await this.activateExtension(dbExt);
  }

  async uninstallExtension(id: string) {
    const loaded = this.extensions.get(id);
    if (loaded) {
      if (typeof loaded.exports.deactivate === "function") {
        try { await loaded.exports.deactivate(); } catch {}
      }
      loaded.disposables.forEach((d) => d());
      this.extensions.delete(id);
      // Remove all contributions from this extension
      for (const [key, val] of this._activityBarItems) if (val.extensionId === id) this._activityBarItems.delete(key);
      for (const [key, val] of this._statusBarItems) if (val.extensionId === id) this._statusBarItems.delete(key);
      for (const [key, val] of this._commands) if (val.extensionId === id) this._commands.delete(key);
      for (const [key, val] of this._sidebarPanels) if (val.extensionId === id) this._sidebarPanels.delete(key);
      for (const [key, val] of this._chatCommands) if (val.extensionId === id) this._chatCommands.delete(key);
      for (const [key, val] of this._terminalCommands) if (val.extensionId === id) this._terminalCommands.delete(key);
      for (const [key, val] of this._contextMenuItems) if (val.extensionId === id) this._contextMenuItems.delete(key);
    }
    await db.extensions.delete(id);
    await db.extensionState.where("extensionId").equals(id).delete();
    this.notify();
  }

  async enableExtension(id: string) {
    await db.extensions.update(id, { enabled: true });
    const ext = await db.extensions.get(id);
    if (ext) await this.activateExtension(ext);
  }

  async disableExtension(id: string) {
    const loaded = this.extensions.get(id);
    if (loaded) {
      if (typeof loaded.exports.deactivate === "function") {
        try { await loaded.exports.deactivate(); } catch {}
      }
      this.extensions.delete(id);
    }
    await db.extensions.update(id, { enabled: false });
    // Remove runtime contributions
    for (const [key, val] of this._activityBarItems) if (val.extensionId === id) this._activityBarItems.delete(key);
    for (const [key, val] of this._statusBarItems) if (val.extensionId === id) this._statusBarItems.delete(key);
    for (const [key, val] of this._commands) if (val.extensionId === id) this._commands.delete(key);
    for (const [key, val] of this._sidebarPanels) if (val.extensionId === id) this._sidebarPanels.delete(key);
    for (const [key, val] of this._chatCommands) if (val.extensionId === id) this._chatCommands.delete(key);
    for (const [key, val] of this._terminalCommands) if (val.extensionId === id) this._terminalCommands.delete(key);
    for (const [key, val] of this._contextMenuItems) if (val.extensionId === id) this._contextMenuItems.delete(key);
    this.notify();
  }

  // ─── Getters ──────────────────────────────────────────────────────

  getActivityBarItems(): (ActivityBarContribution & { extensionId: string })[] {
    return [...this._activityBarItems.values()].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  getStatusBarItems(): StatusBarItemRuntime[] {
    return [...this._statusBarItems.values()].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  getCommands(): CommandRegistration[] {
    return [...this._commands.values()];
  }

  getSidebarPanel(id: string): SidebarPanelRuntime | undefined {
    return this._sidebarPanels.get(id);
  }

  getAllSidebarPanels(): SidebarPanelRuntime[] {
    return [...this._sidebarPanels.values()];
  }

  getChatCommands(): ChatCommandRuntime[] {
    return [...this._chatCommands.values()];
  }

  getTerminalCommands(): TerminalCommandRuntime[] {
    return [...this._terminalCommands.values()];
  }

  getContextMenuItems(): ContextMenuRuntime[] {
    return [...this._contextMenuItems.values()];
  }

  getInstalledExtensions(): Map<string, LoadedExtension> {
    return this.extensions;
  }

  isExtensionInstalled(id: string): boolean {
    return this.extensions.has(id);
  }

  dispose() {
    for (const [, ext] of this.extensions) {
      if (typeof ext.exports.deactivate === "function") {
        try { ext.exports.deactivate(); } catch {}
      }
      ext.disposables.forEach((d) => d());
    }
    this.extensions.clear();
    this.listeners.clear();
  }
}
