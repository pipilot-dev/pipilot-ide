import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from "react";
import { ExtensionHost } from "@/lib/extensions/ExtensionHost";

const ExtensionContext = createContext<ExtensionHost | null>(null);

export function ExtensionProvider({ children }: { children: ReactNode }) {
  const hostRef = useRef<ExtensionHost | null>(null);
  const [, setReady] = useState(false);

  useEffect(() => {
    const host = new ExtensionHost();
    hostRef.current = host;
    host.init().then(() => setReady(true)).catch((err) => {
      console.error("[ExtensionProvider] init failed:", err);
      setReady(true); // still render app even if extensions fail
    });
    return () => host.dispose();
  }, []);

  // Always render children (extensions load in background)
  return (
    <ExtensionContext.Provider value={hostRef.current}>
      {children}
    </ExtensionContext.Provider>
  );
}

export function useExtensionHost(): ExtensionHost | null {
  return useContext(ExtensionContext);
}

/** Subscribe to extension registry changes and re-render */
export function useExtensions() {
  const host = useExtensionHost();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!host) return;
    return host.subscribe(() => setVersion((v) => v + 1));
  }, [host]);

  // Memoize arrays so they don't change reference unless version bumps
  const activityBarItems = host?.getActivityBarItems() ?? [];
  const statusBarItems = host?.getStatusBarItems() ?? [];
  const commands = host?.getCommands() ?? [];
  const chatCommands = host?.getChatCommands() ?? [];
  const terminalCommands = host?.getTerminalCommands() ?? [];
  const contextMenuItems = host?.getContextMenuItems() ?? [];
  const sidebarPanels = host?.getAllSidebarPanels() ?? [];

  // version is used implicitly — when it increments, this hook re-runs and reads fresh data
  void version;

  return { host, activityBarItems, statusBarItems, commands, chatCommands, terminalCommands, contextMenuItems, sidebarPanels };
}
