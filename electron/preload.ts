import { contextBridge } from "electron";

// Expose minimal info to renderer — all server communication stays HTTP
contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  isElectron: true,
});
