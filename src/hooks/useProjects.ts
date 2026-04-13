import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useActiveProject } from "@/contexts/ProjectContext";
import { useCallback } from "react";
import { getSeedFiles, type ProjectTemplate } from "@/lib/project-templates";

export function useProjects() {
  const { activeProjectId, switchProject } = useActiveProject();

  // All projects, including soft-closed ones. Used for the File → Recent menu.
  const allProjects = useLiveQuery(() => db.projects.toArray(), []) ?? [];
  // Active projects — excludes soft-closed. Used for the main switcher list.
  const projects = allProjects.filter((p) => !p.closedAt);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const createProject = useCallback(async (
    name: string,
    type: "static" | "nodebox" | "cloud" = "static",
    template?: ProjectTemplate
  ): Promise<string> => {
    // Use slugified name as ID — check availability
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    let id = baseSlug || "project";
    const existing = await db.projects.get(id);
    if (existing) {
      id = `${baseSlug}-${Date.now().toString(36).slice(-4)}`;
    }
    const now = new Date();

    // Resolve template from type if not specified
    const resolvedTemplate: ProjectTemplate = template || (type === "static" ? "static" : type === "nodebox" ? "node" : "vite-react");

    await db.projects.put({
      id,
      name,
      type,
      template: resolvedTemplate,
      createdAt: now,
      updatedAt: now,
    });

    // Generate seed files from template
    const seedFiles = getSeedFiles(name, resolvedTemplate);

    await db.files.bulkPut(
      seedFiles.map((f) => ({
        ...f,
        projectId: id,
        createdAt: now,
        updatedAt: now,
      }))
    );

    // Auto-seed template files to the server workspace
    try {
      await fetch("/api/files/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: id,
          files: seedFiles.filter(f => f.type === "file").map(f => ({ path: f.id, content: f.content || "" })),
        }),
      });
    } catch {}

    // Create a default chat session for the new project
    await db.chatSessions.put({
      id: `chat-${id}`,
      name: "New Chat",
      projectId: id,
      createdAt: now,
      updatedAt: now,
    });

    // Switch to the new project
    await switchProject(id);

    return id;
  }, [switchProject]);

  const renameProject = useCallback(async (id: string, name: string): Promise<void> => {
    await db.projects.update(id, { name, updatedAt: new Date() });
  }, []);

  /**
   * Open an external folder on disk as a project.
   * Calls the server to register the linked workspace, then creates a
   * corresponding project entry in IndexedDB so it shows up in the
   * project switcher.
   */
  const openFolder = useCallback(async (absolutePath: string, displayName?: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/workspaces/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absolutePath, name: displayName }),
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to open folder");
      }
      const ws = data.workspace as { id: string; name: string; absolutePath: string; template?: string };

      // Create or update the matching project record in IndexedDB
      const existing = await db.projects.get(ws.id);
      const now = new Date();
      if (!existing) {
        await db.projects.put({
          id: ws.id,
          name: ws.name,
          type: "linked",
          template: ws.template,
          linkedPath: ws.absolutePath,
          createdAt: now,
          updatedAt: now,
        });
        // Create a default chat session for the linked project
        await db.chatSessions.put({
          id: `chat-${ws.id}`,
          name: "New Chat",
          projectId: ws.id,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await db.projects.update(ws.id, { updatedAt: now });
      }

      await switchProject(ws.id);
      return ws.id;
    } catch (err) {
      console.error("openFolder failed:", err);
      throw err;
    }
  }, [switchProject]);

  const deleteProject = useCallback(async (id: string): Promise<{ partial?: boolean; path?: string; leftoverCount?: number; message?: string } | void> => {
    const allProjectsRaw = await db.projects.toArray();
    // Block only if deleting this one would leave the user with NO open
    // project to switch to. Closed projects still in the Recent menu
    // don't count, but the target (even if currently open) is being
    // removed, so we check the OTHER open projects.
    const otherOpenCount = allProjectsRaw.filter(
      (p) => p.id !== id && !p.closedAt,
    ).length;
    const target = allProjectsRaw.find((p) => p.id === id);
    const targetIsOpen = target && !target.closedAt;
    if (targetIsOpen && otherOpenCount === 0) {
      throw new Error("Cannot delete the last open project");
    }

    // For linked folders: just unlink (do NOT delete the user's files on disk)
    let partialResult: { partial: true; path: string; leftoverCount: number; message: string } | null = null;
    if (target?.type === "linked") {
      try {
        await fetch("/api/workspaces/unlink", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: id }),
        });
      } catch (err) {
        console.warn("[deleteProject] unlink failed:", err);
      }
    } else {
      // Delete workspace folder on disk for owned projects.
      // Surface server failures so the IndexedDB record isn't removed when
      // the disk folder is still locked. The server may also report a
      // PARTIAL success (folder emptied but not removed) — we capture that
      // and re-throw it to the caller as a typed error so the UI can show
      // a dedicated manual-removal dialog.
      try {
        const res = await fetch(
          `/api/files/workspace?projectId=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          let errMsg = `HTTP ${res.status}`;
          try {
            const data = await res.json();
            if (data?.error) errMsg = data.error;
          } catch {}
          throw new Error(errMsg);
        }
        // Check for partial success
        try {
          const data = await res.json();
          if (data?.partial) {
            partialResult = {
              partial: true,
              path: data.path,
              leftoverCount: data.leftoverCount || 0,
              message: data.message || "Folder couldn't be removed.",
            };
          }
        } catch {}
      } catch (err) {
        throw new Error(
          `Failed to delete workspace folder on disk: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    }

    // Delete all files belonging to this project
    const projectFiles = await db.files.where("projectId").equals(id).toArray();
    await db.files.bulkDelete(projectFiles.map((f) => f.id));

    // Delete all checkpoints belonging to this project
    const projectCheckpoints = await db.checkpoints.where("projectId").equals(id).toArray();
    await db.checkpoints.bulkDelete(projectCheckpoints.map((c) => c.id));

    // Delete all chat sessions belonging to this project
    const projectSessions = await db.chatSessions.where("projectId").equals(id).toArray();
    for (const session of projectSessions) {
      // Delete messages for each session
      const messages = await db.chatMessages.where("sessionId").equals(session.id).toArray();
      await db.chatMessages.bulkDelete(messages.map((m) => m.id));
    }
    await db.chatSessions.bulkDelete(projectSessions.map((s) => s.id));

    // Delete the project itself
    await db.projects.delete(id);

    // If the deleted project was active, switch to another OPEN project
    if (activeProjectId === id) {
      const remainingOpen = (await db.projects.toArray()).filter(
        (p) => !p.closedAt,
      );
      if (remainingOpen.length > 0) {
        await switchProject(remainingOpen[0].id);
      }
    }

    // Return the partial-delete info so the UI can show the manual-removal dialog
    if (partialResult) return partialResult;
  }, [activeProjectId, switchProject]);

  /**
   * Soft-close a project: mark it with `closedAt` so it disappears from the
   * main switcher list, but its IndexedDB records (project row, files,
   * chat history, checkpoints) are preserved so the user can re-open it
   * later from File → Recent. No files on disk are touched.
   *
   * For linked projects, the server-side link registry entry IS removed
   * (otherwise the file watcher stays attached). We keep `linkedPath` on
   * the project row so reopenProject can re-register it.
   */
  const closeProject = useCallback(async (id: string): Promise<void> => {
    const activeCount = (await db.projects.toArray()).filter((p) => !p.closedAt).length;
    if (activeCount <= 1) {
      throw new Error("Cannot close the last project");
    }

    const target = await db.projects.get(id);
    if (!target) return;

    // Linked: unregister with the server so the file watcher detaches.
    // The linkedPath is kept on the DBProject row so we can re-link later.
    if (target.type === "linked") {
      try {
        await fetch("/api/workspaces/unlink", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: id }),
        });
      } catch (err) {
        console.warn("[closeProject] unlink failed:", err);
      }
    }

    // Soft-delete — mark as closed, preserve everything else
    await db.projects.update(id, { closedAt: new Date() });

    // If the closed project was active, switch to another OPEN project
    if (activeProjectId === id) {
      const remainingOpen = (await db.projects.toArray()).filter(
        (p) => !p.closedAt,
      );
      if (remainingOpen.length > 0) {
        await switchProject(remainingOpen[0].id);
      }
    }
  }, [activeProjectId, switchProject]);

  /**
   * Re-open a previously closed project. Clears `closedAt` and switches
   * the active project to it. For linked projects, re-registers with the
   * server using the stored `linkedPath`.
   */
  const reopenProject = useCallback(async (id: string): Promise<void> => {
    const target = await db.projects.get(id);
    if (!target) return;

    // For linked projects, re-register with the server so the file watcher
    // reattaches to the on-disk folder.
    if (target.type === "linked" && target.linkedPath) {
      try {
        const res = await fetch("/api/workspaces/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            absolutePath: target.linkedPath,
            name: target.name,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || "Failed to re-link folder");
        }
        // The server may assign a new linked-{timestamp} id. If so, move
        // the DBProject row and all its related records to the new id.
        const newId = data.workspace?.id as string | undefined;
        if (newId && newId !== id) {
          // Copy project row under the new id
          const { id: _oldId, ...rest } = target;
          await db.projects.put({
            ...rest,
            id: newId,
            closedAt: undefined,
            updatedAt: new Date(),
          });

          // Re-key chat sessions (projectId field)
          const sessions = await db.chatSessions.where("projectId").equals(id).toArray();
          for (const s of sessions) {
            await db.chatSessions.put({ ...s, projectId: newId });
          }
          // Checkpoints (projectId field)
          const cps = await db.checkpoints.where("projectId").equals(id).toArray();
          for (const cp of cps) {
            await db.checkpoints.put({ ...cp, projectId: newId });
          }
          // Files (projectId field) — note: file rows have their own `id`,
          // only `projectId` needs updating
          const fs = await db.files.where("projectId").equals(id).toArray();
          for (const f of fs) {
            await db.files.put({ ...f, projectId: newId });
          }

          // Remove the old project row
          await db.projects.delete(id);
          await switchProject(newId);
          return;
        }
      } catch (err) {
        console.error("[reopenProject] re-link failed:", err);
        throw err;
      }
    }

    // Clear closedAt — same id stays
    await db.projects.update(id, { closedAt: undefined, updatedAt: new Date() });
    await switchProject(id);
  }, [switchProject]);

  return {
    projects,
    allProjects,        // includes soft-closed ones (for File → Recent menu)
    activeProject,
    createProject,
    openFolder,
    renameProject,
    deleteProject,
    closeProject,
    reopenProject,
    switchProject,
  };
}
