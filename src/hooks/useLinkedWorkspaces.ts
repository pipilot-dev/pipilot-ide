/**
 * Linked workspaces hook — manages folders opened from disk via the
 * server-side linked workspace registry.
 */

import { useState, useCallback, useEffect } from "react";
import { apiGet, apiPost } from "@/lib/api";

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
      const data = await apiGet("/api/workspaces/list");
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
      const data = await apiPost("/api/workspaces/link", { absolutePath, name });
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
      await apiPost("/api/workspaces/unlink", { projectId });
      await refresh();
    } catch (err: any) {
      setError(err.message);
    }
  }, [refresh]);

  const touchWorkspace = useCallback(async (projectId: string) => {
    try {
      await apiPost("/api/workspaces/touch", { projectId });
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
