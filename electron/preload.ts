import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  isElectron: true,

  // Generic request/response (replaces fetch for non-streaming)
  invoke: (channel: string, ...args: any[]) =>
    ipcRenderer.invoke(channel, ...args),

  // Send fire-and-forget messages
  send: (channel: string, ...args: any[]) =>
    ipcRenderer.send(channel, ...args),

  // Listen for events from main process (for streaming)
  on: (channel: string, callback: (...args: any[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: any[]) =>
      callback(...args);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },

  // One-time listener
  once: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.once(
      channel,
      (_event: Electron.IpcRendererEvent, ...args: any[]) => callback(...args)
    );
  },

  // Remove all listeners for a channel
  removeAllListeners: (channel: string) =>
    ipcRenderer.removeAllListeners(channel),
});
