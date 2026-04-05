import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useActiveProject } from "@/contexts/ProjectContext";
import { useCallback } from "react";

export function useProjects() {
  const { activeProjectId, switchProject } = useActiveProject();

  // Live query for all projects
  const projects = useLiveQuery(() => db.projects.toArray(), []) ?? [];

  // Derive the active project from the live list
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const createProject = useCallback(async (name: string): Promise<string> => {
    const id = `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();

    await db.projects.put({
      id,
      name,
      createdAt: now,
      updatedAt: now,
    });

    // Seed with sample files
    const sampleHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name}</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <h1>Welcome to ${name}</h1>
  <p>Start building your project here.</p>
  <script src="script.js"></script>
</body>
</html>`;

    const sampleCss = `body {
  font-family: system-ui, sans-serif;
  margin: 0;
  padding: 2rem;
  background: #1a1a2e;
  color: #eee;
}

h1 {
  color: #e94560;
}`;

    const sampleJs = `// ${name} - main script
console.log("Hello from ${name}!");
`;

    const seedFiles = [
      { id: "index.html", name: "index.html", type: "file" as const, parentPath: "", language: "html", content: sampleHtml },
      { id: "style.css", name: "style.css", type: "file" as const, parentPath: "", language: "css", content: sampleCss },
      { id: "script.js", name: "script.js", type: "file" as const, parentPath: "", language: "javascript", content: sampleJs },
    ];

    await db.files.bulkPut(
      seedFiles.map((f) => ({
        ...f,
        projectId: id,
        createdAt: now,
        updatedAt: now,
      }))
    );

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

  const deleteProject = useCallback(async (id: string): Promise<void> => {
    // Don't allow deleting the last project
    const allProjects = await db.projects.toArray();
    if (allProjects.length <= 1) {
      throw new Error("Cannot delete the last project");
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
    renameProject,
    deleteProject,
    switchProject,
  };
}
