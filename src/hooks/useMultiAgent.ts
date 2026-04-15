/**
 * Multi-agent state management.
 * Manages a list of agent tabs, each with its own session.
 * The actual useAgentChat hook runs inside AgentTabProvider components.
 */

import { useState, useCallback } from "react";

export interface AgentTab {
  id: string;
  name: string;
  projectId: string;
  sessionId: string;
  status: "idle" | "streaming" | "working" | "error";
  createdAt: number;
}

const STORAGE_KEY = "pipilot:agent-tabs";

function generateId() {
  return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function loadTabs(): AgentTab[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
}

function saveTabs(tabs: AgentTab[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs)); } catch {}
}

export function useMultiAgent(projectId: string) {
  const [tabs, setTabs] = useState<AgentTab[]>(() => {
    const saved = loadTabs().filter((t) => t.projectId === projectId);
    if (saved.length > 0) return saved;
    // Default: one "Main" agent tab
    const mainTab: AgentTab = {
      id: "main",
      name: "Main",
      projectId,
      sessionId: `agent-${projectId}`,
      status: "idle",
      createdAt: Date.now(),
    };
    return [mainTab];
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      return localStorage.getItem(`pipilot:active-agent-tab:${projectId}`) || "main";
    } catch { return "main"; }
  });

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    try { localStorage.setItem(`pipilot:active-agent-tab:${projectId}`, tabId); } catch {}
  }, [projectId]);

  const createTab = useCallback((name?: string, customProjectId?: string) => {
    const id = generateId();
    const pid = customProjectId || projectId;
    const tab: AgentTab = {
      id,
      name: name || `Agent ${tabs.length + 1}`,
      projectId: pid,
      sessionId: `agent-${pid}-${id}`,
      status: "idle",
      createdAt: Date.now(),
    };
    setTabs((prev) => {
      const next = [...prev, tab];
      saveTabs(next);
      return next;
    });
    setActiveTabId(id);
    try { localStorage.setItem(`pipilot:active-agent-tab:${projectId}`, id); } catch {}
    return tab;
  }, [projectId, tabs.length]);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      // Can't close the last tab
      if (prev.length <= 1) return prev;
      const next = prev.filter((t) => t.id !== tabId);
      saveTabs(next);
      // If closing the active tab, switch to the previous one
      if (activeTabId === tabId) {
        const idx = prev.findIndex((t) => t.id === tabId);
        const newActive = next[Math.min(idx, next.length - 1)]?.id || next[0]?.id;
        setActiveTabId(newActive);
        try { localStorage.setItem(`pipilot:active-agent-tab:${projectId}`, newActive); } catch {}
      }
      return next;
    });
  }, [activeTabId, projectId]);

  const renameTab = useCallback((tabId: string, name: string) => {
    setTabs((prev) => {
      const next = prev.map((t) => t.id === tabId ? { ...t, name } : t);
      saveTabs(next);
      return next;
    });
  }, []);

  const updateTabStatus = useCallback((tabId: string, status: AgentTab["status"]) => {
    setTabs((prev) => {
      const next = prev.map((t) => t.id === tabId ? { ...t, status } : t);
      // Don't persist status to localStorage (it's transient)
      return next;
    });
  }, []);

  return {
    tabs,
    activeTab,
    activeTabId,
    switchTab,
    createTab,
    closeTab,
    renameTab,
    updateTabStatus,
  };
}
