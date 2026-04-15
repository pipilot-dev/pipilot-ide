/**
 * Multi-agent state management — IndexedDB backed.
 * Each agent tab has its own independent chat session.
 * Agent tab sessions are prefixed with "multiagent-" to avoid
 * appearing in the regular session picker dropdown.
 */

import { useState, useCallback, useEffect } from "react";
import { db } from "@/lib/db";

export interface AgentTab {
  id: string;
  name: string;
  projectId: string;
  sessionId: string;
  status: "idle" | "streaming" | "working" | "error";
  createdAt: number;
}

function generateId() {
  return `ma-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// Store agent tabs in a dedicated IndexedDB settings key per project
const TABS_KEY = (pid: string) => `agent-tabs:${pid}`;
const ACTIVE_KEY = (pid: string) => `agent-active-tab:${pid}`;

async function loadTabs(projectId: string): Promise<AgentTab[]> {
  try {
    const entry = await db.settings.get(TABS_KEY(projectId));
    if (entry?.value) return JSON.parse(entry.value);
  } catch {}
  return [];
}

async function saveTabs(projectId: string, tabs: AgentTab[]) {
  try {
    await db.settings.put({ key: TABS_KEY(projectId), value: JSON.stringify(tabs) });
  } catch {}
}

async function loadActiveTabId(projectId: string): Promise<string> {
  try {
    const entry = await db.settings.get(ACTIVE_KEY(projectId));
    if (entry?.value) return entry.value;
  } catch {}
  return "main";
}

async function saveActiveTabId(projectId: string, tabId: string) {
  try {
    await db.settings.put({ key: ACTIVE_KEY(projectId), value: tabId });
  } catch {}
}

export function useMultiAgent(projectId: string) {
  const [tabs, setTabs] = useState<AgentTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("main");
  const [loaded, setLoaded] = useState(false);

  // Load from IndexedDB on mount / project change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedTabs = await loadTabs(projectId);
      const savedActive = await loadActiveTabId(projectId);
      if (cancelled) return;

      if (savedTabs.length > 0) {
        setTabs(savedTabs);
        setActiveTabId(savedActive);
      } else {
        // Default: one "Main" agent tab using the standard session
        const mainTab: AgentTab = {
          id: "main",
          name: "Main",
          projectId,
          sessionId: `agent-${projectId}`,
          status: "idle",
          createdAt: Date.now(),
        };
        setTabs([mainTab]);
        setActiveTabId("main");
        await saveTabs(projectId, [mainTab]);
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0] || null;

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    saveActiveTabId(projectId, tabId);
  }, [projectId]);

  const createTab = useCallback((name?: string, customProjectId?: string) => {
    const id = generateId();
    // New agents start with no project — user picks one via Open Folder or Generate
    const pid = customProjectId || "";
    const tab: AgentTab = {
      id,
      name: name || `Agent ${tabs.length + 1}`,
      projectId: pid,
      sessionId: `multiagent-${id}`,
      status: "idle",
      createdAt: Date.now(),
    };

    setTabs((prev) => {
      const next = [...prev, tab];
      saveTabs(projectId, next);
      return next;
    });
    setActiveTabId(id);
    saveActiveTabId(projectId, id);

    // Create the chat session in IndexedDB so it exists before messages are added
    db.chatSessions.put({
      id: tab.sessionId,
      name: tab.name,
      projectId: pid,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).catch(() => {});

    return tab;
  }, [projectId, tabs.length]);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((t) => t.id !== tabId);
      saveTabs(projectId, next);

      if (activeTabId === tabId) {
        const idx = prev.findIndex((t) => t.id === tabId);
        const newActive = next[Math.min(idx, next.length - 1)]?.id || next[0]?.id;
        setActiveTabId(newActive);
        saveActiveTabId(projectId, newActive);
      }
      return next;
    });
  }, [activeTabId, projectId]);

  const renameTab = useCallback((tabId: string, name: string) => {
    setTabs((prev) => {
      const next = prev.map((t) => t.id === tabId ? { ...t, name } : t);
      saveTabs(projectId, next);
      return next;
    });
  }, [projectId]);

  const linkProjectToTab = useCallback((tabId: string, newProjectId: string) => {
    setTabs((prev) => {
      const next = prev.map((t) => t.id === tabId ? { ...t, projectId: newProjectId } : t);
      saveTabs(projectId, next);
      return next;
    });
  }, [projectId]);

  const updateTabStatus = useCallback((tabId: string, status: AgentTab["status"]) => {
    setTabs((prev) => prev.map((t) => t.id === tabId ? { ...t, status } : t));
  }, []);

  return {
    tabs,
    activeTab,
    activeTabId,
    switchTab,
    createTab,
    closeTab,
    renameTab,
    linkProjectToTab,
    updateTabStatus,
    loaded,
  };
}
