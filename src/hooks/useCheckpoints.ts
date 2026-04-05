import { useState, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, DBFile, DBCheckpoint } from "@/lib/db";
import { useActiveProject } from "@/contexts/ProjectContext";

const MAX_CHECKPOINTS = 50;

export function useCheckpoints() {
  const { activeProjectId } = useActiveProject();
  const [currentIndex, setCurrentIndex] = useState(0);

  const checkpoints =
    useLiveQuery(
      () =>
        activeProjectId
          ? db.checkpoints
              .where("projectId")
              .equals(activeProjectId)
              .reverse()
              .sortBy("createdAt")
          : Promise.resolve([]),
      [activeProjectId]
    ) ?? [];

  // Sort descending by createdAt (newest first)
  const sorted = [...checkpoints].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  const canUndo = currentIndex < sorted.length - 1;
  const canRedo = currentIndex > 0;

  const createCheckpoint = useCallback(
    async (label: string, messageId?: string) => {
      if (!activeProjectId) return;

      // Snapshot all files for this project
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
    [activeProjectId]
  );

  /**
   * Find the checkpoint that captures file state BEFORE a given user message's AI actions.
   * We create a "before-{messageId}" checkpoint right before the AI starts working.
   * This is the one we want to restore to.
   */
  const findCheckpointBeforeMessage = useCallback(
    async (messageId: string): Promise<string | null> => {
      if (!activeProjectId) return null;

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

      // No checkpoint found — return null
      return null;
    },
    [activeProjectId]
  );

  const restoreToCheckpoint = useCallback(
    async (id: string) => {
      if (!activeProjectId) return;

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
        // Delete all files for this project
        const existing = await db.files
          .where("projectId")
          .equals(activeProjectId)
          .toArray();
        await db.files.bulkDelete(existing.map((f) => f.id));

        // Restore snapshot
        await db.files.bulkPut(hydratedFiles);
      });

      // Update currentIndex to match this checkpoint's position
      const idx = sorted.findIndex((c) => c.id === id);
      if (idx !== -1) {
        setCurrentIndex(idx);
      }
    },
    [activeProjectId, sorted]
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
