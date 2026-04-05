import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { db } from "@/lib/db";

interface ProjectContextValue {
  activeProjectId: string;
  switchProject: (id: string) => Promise<void>;
  loading: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const DEFAULT_PROJECT_ID = "default-project";

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [activeProjectId, setActiveProjectId] = useState<string>(DEFAULT_PROJECT_ID);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const setting = await db.settings.get("activeProjectId");
      if (!cancelled) {
        setActiveProjectId(setting?.value ?? DEFAULT_PROJECT_ID);
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const switchProject = useCallback(async (id: string) => {
    await db.settings.put({ key: "activeProjectId", value: id });
    setActiveProjectId(id);
  }, []);

  return (
    <ProjectContext.Provider value={{ activeProjectId, switchProject, loading }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useActiveProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useActiveProject must be used within a ProjectProvider");
  }
  return ctx;
}
