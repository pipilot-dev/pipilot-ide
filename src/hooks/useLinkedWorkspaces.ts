/**
 * Linked workspaces hook — manages folders opened from disk via the
 * server-side linked workspace registry.
 */

import { useState, useCallback, useEffect } from "react";

export interface LinkedWorkspace {
  id: string;
  name: string;
  absolutePath: string;
  template?: string;
  linkedAt: number;
  lastOpened?: number;
}

export function useLinkedWorkspaces() {
  const [workspaces, setWorkspaces] = useState<LinkedWorkspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces/list");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWorkspaces(data.workspaces || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const linkFolder = useCallback(async (absolutePath: string, name?: string): Promise<LinkedWorkspace | null> => {
    setError(null);
    try {
      const res = await fetch("/api/workspaces/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath, name }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to link folder");
      }
      await refresh();
      return data.workspace as LinkedWorkspace;
    } catch (err: any) {
      setError(err.message);
      return null;
    }
  }, [refresh]);

  const unlinkFolder = useCallback(async (projectId: string) => {
    try {
      await fetch("/api/workspaces/unlink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      await refresh();
    } catch (err: any) {
      setError(err.message);
    }
  }, [refresh]);

  const touchWorkspace = useCallback(async (projectId: string) => {
    try {
      await fetch("/api/workspaces/touch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
    } catch {}
  }, []);

  return {
    workspaces,
    loading,
    error,
    refresh,
    linkFolder,
    unlinkFolder,
    touchWorkspace,
  };
}
