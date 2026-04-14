/**
 * Filesystem bridge — abstracts file operations between:
 *   - Web mode: HTTP fetch to Express /api/files/* endpoints
 *   - Tauri mode: IPC invoke to Rust fs commands (zero HTTP)
 *
 * The bridge auto-detects the runtime and routes calls accordingly.
 * Components use this instead of calling fetch directly.
 */

// Detect Tauri at runtime
const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

// ── Types ──

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export interface FsStat {
  size: number;
  is_dir: boolean;
  is_file: boolean;
  modified: number;
}

export interface FsBridge {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  createDir(path: string): Promise<void>;
  delete(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copy(src: string, dest: string): Promise<void>;
  listDir(path: string): Promise<FsEntry[]>;
  stat(path: string): Promise<FsStat>;
  exists(path: string): Promise<boolean>;
}

// ── Tauri IPC bridge ──

function createTauriBridge(): FsBridge {
  let invoke: any;

  const init = async () => {
    if (!invoke) {
      const core = await import("@tauri-apps/api/core");
      invoke = core.invoke;
    }
  };

  return {
    async readFile(path) {
      await init();
      return invoke("fs_read_file", { path });
    },

    async writeFile(path, content) {
      await init();
      return invoke("fs_write_file", { path, content });
    },

    async createDir(path) {
      await init();
      return invoke("fs_create_dir", { path });
    },

    async delete(path) {
      await init();
      return invoke("fs_delete", { path });
    },

    async rename(oldPath, newPath) {
      await init();
      return invoke("fs_rename", { oldPath, newPath });
    },

    async copy(src, dest) {
      await init();
      return invoke("fs_copy", { src, dest });
    },

    async listDir(path) {
      await init();
      return invoke("fs_list_dir", { path });
    },

    async stat(path) {
      await init();
      return invoke("fs_stat", { path });
    },

    async exists(path) {
      await init();
      return invoke("fs_exists", { path });
    },
  };
}

// ── HTTP bridge (existing web mode) ──

function createWebBridge(): FsBridge {
  return {
    async readFile(path) {
      const res = await fetch(
        `/api/files/read?projectId=default&path=${encodeURIComponent(path)}`
      );
      if (!res.ok) throw new Error(`Failed to read file: ${res.statusText}`);
      const data = await res.json();
      return data.content;
    },

    async writeFile(path, content) {
      const res = await fetch("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "default", path, content }),
      });
      if (!res.ok) throw new Error(`Failed to write file: ${res.statusText}`);
    },

    async createDir(path) {
      const res = await fetch("/api/files/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "default", path }),
      });
      if (!res.ok) throw new Error(`Failed to create dir: ${res.statusText}`);
    },

    async delete(path) {
      const res = await fetch(
        `/api/files?projectId=default&path=${encodeURIComponent(path)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`Failed to delete: ${res.statusText}`);
    },

    async rename(oldPath, newPath) {
      const res = await fetch("/api/files/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "default", oldPath, newPath }),
      });
      if (!res.ok) throw new Error(`Failed to rename: ${res.statusText}`);
    },

    async copy(src, dest) {
      // Web mode: read source then write to dest (no dedicated copy endpoint)
      const content = await this.readFile(src);
      await this.writeFile(dest, content);
    },

    async listDir(path) {
      const res = await fetch(
        `/api/files/list-dir?projectId=default&path=${encodeURIComponent(path)}`
      );
      if (!res.ok) throw new Error(`Failed to list dir: ${res.statusText}`);
      const data = await res.json();
      // Normalize the Express response shape to match FsEntry[]
      return (data.entries || data || []).map((e: any) => ({
        name: e.name,
        path: e.path || `${path}/${e.name}`,
        is_dir: e.is_dir ?? e.isDir ?? e.type === "directory",
        size: e.size || 0,
      }));
    },

    async stat(path) {
      // Web mode: use list-dir on parent + find the entry
      const parts = path.replace(/\\/g, "/").split("/");
      const name = parts.pop()!;
      const parent = parts.join("/") || "/";
      const entries = await this.listDir(parent);
      const entry = entries.find((e) => e.name === name);
      if (!entry) throw new Error(`Path not found: ${path}`);
      return {
        size: entry.size,
        is_dir: entry.is_dir,
        is_file: !entry.is_dir,
        modified: 0, // Not available from list-dir
      };
    },

    async exists(path) {
      try {
        await this.stat(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

// ── Export the appropriate bridge ──

export const fsBridge: FsBridge = isTauri
  ? createTauriBridge()
  : createWebBridge();

/** Check if we're running inside Tauri */
export const isDesktopApp = isTauri;
