import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Plus, Check, FolderOpen } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";

export function ProjectSwitcher() {
  const { projects, activeProject, createProject, switchProject } = useProjects();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleNewProject = useCallback(async () => {
    const name = prompt("Enter project name:");
    if (!name?.trim()) return;
    await createProject(name.trim());
    setOpen(false);
  }, [createProject]);

  const handleSwitch = useCallback(async (id: string) => {
    await switchProject(id);
    setOpen(false);
  }, [switchProject]);

  return (
    <div ref={dropdownRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors"
        style={{
          color: "hsl(220 14% 75%)",
          background: open ? "hsl(220 13% 22%)" : "transparent",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = "hsl(220 13% 20%)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "transparent";
        }}
      >
        <FolderOpen size={12} style={{ color: "hsl(220 14% 55%)" }} />
        <span className="truncate" style={{ maxWidth: 120 }}>
          {activeProject?.name ?? "No Project"}
        </span>
        <ChevronDown
          size={12}
          style={{
            color: "hsl(220 14% 55%)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 150ms ease",
          }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute left-0 z-50 mt-1 rounded shadow-lg overflow-hidden"
          style={{
            top: "100%",
            minWidth: 200,
            background: "hsl(220 13% 18%)",
            border: "1px solid hsl(220 13% 25%)",
          }}
        >
          {/* Project list */}
          <div
            className="overflow-y-auto"
            style={{ maxHeight: 240 }}
          >
            {projects.map((project) => {
              const isActive = project.id === activeProject?.id;
              return (
                <button
                  key={project.id}
                  onClick={() => handleSwitch(project.id)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left transition-colors"
                  style={{
                    color: isActive ? "hsl(220 14% 90%)" : "hsl(220 14% 70%)",
                    background: isActive ? "hsl(220 13% 22%)" : "transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = "hsl(220 13% 20%)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span className="flex-shrink-0" style={{ width: 14 }}>
                    {isActive && <Check size={12} style={{ color: "hsl(207 90% 64%)" }} />}
                  </span>
                  <FolderOpen size={12} style={{ color: "hsl(220 14% 50%)" }} />
                  <span className="truncate">{project.name}</span>
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div style={{ borderTop: "1px solid hsl(220 13% 25%)" }} />

          {/* New project button */}
          <button
            onClick={handleNewProject}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left transition-colors"
            style={{ color: "hsl(220 14% 70%)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "hsl(220 13% 20%)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <span className="flex-shrink-0" style={{ width: 14 }}>
              <Plus size={12} style={{ color: "hsl(207 90% 64%)" }} />
            </span>
            <span>New Project</span>
          </button>
        </div>
      )}
    </div>
  );
}
