import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useActiveProject } from "@/contexts/ProjectContext";
import { useCallback } from "react";
import { getSeedFiles, type ProjectTemplate } from "@/lib/project-templates";

export function useProjects() {
  const { activeProjectId, switchProject } = useActiveProject();

  const projects = useLiveQuery(() => db.projects.toArray(), []) ?? [];
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

  const deleteProject = useCallback(async (id: string): Promise<void> => {
    // Don't allow deleting the last project
    const allProjects = await db.projects.toArray();
    if (allProjects.length <= 1) {
      throw new Error("Cannot delete the last project");
    }

    // For linked folders: just unlink (do NOT delete the user's files on disk)
    const target = allProjects.find((p) => p.id === id);
    if (target?.type === "linked") {
      try {
        await fetch("/api/workspaces/unlink", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: id }),
        });
      } catch {}
    } else {
      // Delete workspace folder on disk for owned projects
      try {
        await fetch(`/api/files/workspace?projectId=${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch {}
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

    // If the deleted project was active, switch to another
    if (activeProjectId === id) {
      const remaining = await db.projects.toArray();
      if (remaining.length > 0) {
        await switchProject(remaining[0].id);
      }
    }
  }, [activeProjectId, switchProject]);

  return {
    projects,
    activeProject,
    createProject,
    openFolder,
    renameProject,
    deleteProject,
    switchProject,
  };
}
