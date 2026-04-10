import { useState, useCallback, useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, DBFile, DBCheckpoint } from "@/lib/db";
import { useActiveProject } from "@/contexts/ProjectContext";

const MAX_CHECKPOINTS = 50;

/**
 * Check if a project's files live on disk (linked project, agent mode).
 * Returns the project type from IndexedDB so we can decide between
 * server-side checkpoints (disk snapshots) and local IndexedDB checkpoints.
 */
async function getProjectType(projectId: string | undefined): Promise<string | null> {
  if (!projectId) return null;
  try {
    const p = await db.projects.get(projectId);
    return p?.type || null;
  } catch { return null; }
}

interface ServerCheckpointMeta {
  id: string;
  projectId: string;
  label: string;
  messageId?: string;
  createdAt: number;
  fileCount: number;
  byteSize: number;
}

export function useCheckpoints() {
  const { activeProjectId } = useActiveProject();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [useServer, setUseServer] = useState(false);
  const [serverCheckpoints, setServerCheckpoints] = useState<ServerCheckpointMeta[]>([]);

  // Detect mode: server-side for linked projects, otherwise IndexedDB
  useEffect(() => {
    if (!activeProjectId) {
      setUseServer(false);
      return;
    }
    getProjectType(activeProjectId).then((type) => {
      // Linked = always server. The chat panel hooks pass the right
      // checkpoint manager based on this.
      setUseServer(type === "linked");
    });
  }, [activeProjectId]);

  // Refresh server-side checkpoints when projectId or mode changes
  const refreshServerCheckpoints = useCallback(async () => {
    if (!activeProjectId || !useServer) return;
    try {
      const res = await fetch(`/api/checkpoints/list?projectId=${encodeURIComponent(activeProjectId)}`);
      const data = await res.json();
      setServerCheckpoints(data.checkpoints || []);
    } catch {}
  }, [activeProjectId, useServer]);

  useEffect(() => {
    if (useServer) refreshServerCheckpoints();
  }, [useServer, refreshServerCheckpoints]);

  const localCheckpoints =
    useLiveQuery(
      () =>
        activeProjectId && !useServer
          ? db.checkpoints
              .where("projectId")
              .equals(activeProjectId)
              .reverse()
              .sortBy("createdAt")
          : Promise.resolve([]),
      [activeProjectId, useServer]
    ) ?? [];

  // Sort descending by createdAt (newest first), normalized to common shape
  const sorted = useServer
    ? serverCheckpoints
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((m) => ({
          id: m.id,
          projectId: m.projectId,
          label: m.label,
          snapshot: "", // not loaded client-side for server checkpoints
          createdAt: new Date(m.createdAt),
          messageId: m.messageId,
        }))
    : [...localCheckpoints].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const canUndo = currentIndex < sorted.length - 1;
  const canRedo = currentIndex > 0;

  const createCheckpoint = useCallback(
    async (label: string, messageId?: string) => {
      if (!activeProjectId) return;

      // Server-side branch — for linked projects (files on disk)
      if (useServer) {
        try {
          const res = await fetch("/api/checkpoints/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: activeProjectId, label, messageId }),
          });
          const data = await res.json();
          if (data.success) {
            await refreshServerCheckpoints();
            setCurrentIndex(0);
          }
        } catch (err) {
          console.error("Server checkpoint create failed:", err);
        }
        return;
      }

      // Local IndexedDB branch
      const files = await db.files
        .where("projectId")
        .equals(activeProjectId)
        .toArray();

      const checkpoint: DBCheckpoint = {
        id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        projectId: activeProjectId,
        label,
        snapshot: JSON.stringify(files),
        createdAt: new Date(),
        messageId,
      };

      await db.checkpoints.put(checkpoint);

      // Enforce limit: delete oldest beyond MAX_CHECKPOINTS
      const all = await db.checkpoints
        .where("projectId")
        .equals(activeProjectId)
        .sortBy("createdAt");

      if (all.length > MAX_CHECKPOINTS) {
        const toDelete = all.slice(0, all.length - MAX_CHECKPOINTS);
        await db.checkpoints.bulkDelete(toDelete.map((c) => c.id));
      }

      setCurrentIndex(0);
    },
    [activeProjectId, useServer, refreshServerCheckpoints]
  );

  /**
   * Find the checkpoint that captures file state BEFORE a given user message's AI actions.
   * We create a "before-{messageId}" checkpoint right before the AI starts working.
   * This is the one we want to restore to.
   */
  const findCheckpointBeforeMessage = useCallback(
    async (messageId: string): Promise<string | null> => {
      if (!activeProjectId) return null;

      // Server-side branch
      if (useServer) {
        try {
          const res = await fetch(
            `/api/checkpoints/find-before?projectId=${encodeURIComponent(activeProjectId)}&messageId=${encodeURIComponent(messageId)}`,
          );
          const data = await res.json();
          return data.checkpoint?.id || null;
        } catch {
          return null;
        }
      }

      // Local IndexedDB branch
      const allCheckpoints = await db.checkpoints
        .where("projectId")
        .equals(activeProjectId)
        .sortBy("createdAt");

      // Look for the "before" checkpoint tied to this message
      const beforeCheckpoint = allCheckpoints.find(
        (cp) => cp.messageId === `before-${messageId}`
      );
      if (beforeCheckpoint) return beforeCheckpoint.id;

      // Fallback: find the "after" checkpoint from the previous turn
      const afterCheckpointIdx = allCheckpoints.findIndex(
        (cp) => cp.messageId === messageId
      );
      if (afterCheckpointIdx > 0) {
        return allCheckpoints[afterCheckpointIdx - 1].id;
      }

      return null;
    },
    [activeProjectId, useServer]
  );

  const restoreToCheckpoint = useCallback(
    async (id: string) => {
      if (!activeProjectId) return;

      // Server-side branch — restore disk files via the server
      if (useServer) {
        try {
          const res = await fetch("/api/checkpoints/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: activeProjectId, checkpointId: id }),
          });
          const data = await res.json();
          if (data.success) {
            // Tell file watchers to re-sync
            window.dispatchEvent(new CustomEvent("pipilot:files-changed"));
            const idx = sorted.findIndex((c) => c.id === id);
            if (idx !== -1) setCurrentIndex(idx);
          } else {
            throw new Error(data.message || "Restore failed");
          }
        } catch (err) {
          console.error("Server checkpoint restore failed:", err);
          throw err;
        }
        return;
      }

      // Local IndexedDB branch
      const checkpoint = await db.checkpoints.get(id);
      if (!checkpoint) throw new Error(`Checkpoint not found: ${id}`);

      const snapshotFiles: DBFile[] = JSON.parse(checkpoint.snapshot);

      // Re-hydrate dates (JSON.parse turns them into strings)
      const hydratedFiles = snapshotFiles.map((f) => ({
        ...f,
        createdAt: new Date(f.createdAt),
        updatedAt: new Date(f.updatedAt),
      }));

      await db.transaction("rw", db.files, async () => {
        const existing = await db.files
          .where("projectId")
          .equals(activeProjectId)
          .toArray();
        await db.files.bulkDelete(existing.map((f) => f.id));
        await db.files.bulkPut(hydratedFiles);
      });

      const idx = sorted.findIndex((c) => c.id === id);
      if (idx !== -1) setCurrentIndex(idx);
    },
    [activeProjectId, sorted, useServer]
  );

  const undo = useCallback(async () => {
    if (!canUndo) return;
    const targetIndex = currentIndex + 1;
    const target = sorted[targetIndex];
    if (target) {
      await restoreToCheckpoint(target.id);
      setCurrentIndex(targetIndex);
    }
  }, [canUndo, currentIndex, sorted, restoreToCheckpoint]);

  const redo = useCallback(async () => {
    if (!canRedo) return;
    const targetIndex = currentIndex - 1;
    const target = sorted[targetIndex];
    if (target) {
      await restoreToCheckpoint(target.id);
      setCurrentIndex(targetIndex);
    }
  }, [canRedo, currentIndex, sorted, restoreToCheckpoint]);

  return {
    checkpoints: sorted,
    currentIndex,
    createCheckpoint,
    undo,
    redo,
    restoreToCheckpoint,
    findCheckpointBeforeMessage,
    canUndo,
    canRedo,
  };
}
