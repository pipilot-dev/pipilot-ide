import { useState, useEffect } from "react";
import { useActiveProject } from "@/contexts/ProjectContext";
import { apiGet } from "@/lib/api";

/**
 * Lightweight hook that polls the git status endpoint to return just
 * the count of changed files. Used for the activity bar badge.
 */
export function useGitStatusCount(pollMs = 5000) {
  const { activeProjectId } = useActiveProject();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!activeProjectId) {
      setCount(0);
      return;
    }
    let cancelled = false;

    const fetchCount = async () => {
      try {
        // First check the project is a git repo
        const repoData = await apiGet("/api/git/repo-status", { projectId: activeProjectId });
        if (!repoData.isRepo) {
          if (!cancelled) setCount(0);
          return;
        }
        // Then get the status
        const data = await apiGet("/api/git/status", { projectId: activeProjectId });
        if (!cancelled) setCount((data.files || []).length);
      } catch {}
    };

    fetchCount();
    const interval = setInterval(fetchCount, pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeProjectId, pollMs]);

  return count;
}
