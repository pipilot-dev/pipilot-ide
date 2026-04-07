import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Plus, Check, FolderOpen } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { TEMPLATE_INFO, type ProjectTemplate } from "@/lib/project-templates";

export function ProjectSwitcher() {
  const { projects, activeProject, createProject, switchProject } = useProjects();
  const [open, setOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectType, setNewProjectType] = useState<"static" | "nodebox" | "cloud">("static");
  const [newProjectTemplate, setNewProjectTemplate] = useState<ProjectTemplate>("static");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

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

  const handleNewProject = useCallback(() => {
    setShowCreateForm(true);
    setNewProjectName("");
    setNewProjectType("static");
    setNewProjectTemplate("static");
    setTimeout(() => nameInputRef.current?.focus(), 50);
  }, []);

  const handleCreateSubmit = useCallback(async () => {
    if (!newProjectName.trim()) return;
    await createProject(newProjectName.trim(), newProjectType, newProjectTemplate);
    setShowCreateForm(false);
    setOpen(false);
  }, [createProject, newProjectName, newProjectType, newProjectTemplate]);

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

          {/* New project button / create form */}
          {showCreateForm ? (
            <div style={{ padding: "6px 8px" }}>
              {/* Runtime type selector */}
              <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                {(["static", "nodebox", "cloud"] as const).map((t) => {
                  const colors: Record<string, string> = { static: "hsl(207 90% 54%)", nodebox: "hsl(142 71% 45%)", cloud: "hsl(280 65% 60%)" };
                  const labels: Record<string, string> = { static: "Static", nodebox: "Node.js", cloud: "Cloud" };
                  const active = newProjectType === t;
                  return (
                    <button key={t}
                      onClick={() => {
                        setNewProjectType(t);
                        // Auto-select default template for each type
                        if (t === "static") setNewProjectTemplate("static");
                        else if (t === "nodebox") setNewProjectTemplate("node");
                        else setNewProjectTemplate("vite-react");
                      }}
                      style={{
                        flex: 1, padding: "4px 8px", fontSize: 10, borderRadius: 4, cursor: "pointer",
                        border: active ? `1px solid ${colors[t]}` : "1px solid hsl(220 13% 30%)",
                        background: active ? `${colors[t]}22` : "hsl(220 13% 22%)",
                        color: active ? colors[t] : "hsl(220 14% 55%)",
                      }}
                    >
                      {labels[t]}
                    </button>
                  );
                })}
              </div>

              {/* Framework template selector — shown for cloud and nodebox */}
              {newProjectType !== "static" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 6 }}>
                  <div style={{ fontSize: 9, color: "hsl(220 14% 45%)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Framework
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {(newProjectType === "cloud"
                      ? (["vite-react", "nextjs", "express", "node"] as const)
                      : (["node", "express"] as const)
                    ).map((tmpl) => {
                      const info = TEMPLATE_INFO[tmpl];
                      const active = newProjectTemplate === tmpl;
                      return (
                        <button key={tmpl}
                          onClick={() => setNewProjectTemplate(tmpl)}
                          style={{
                            padding: "3px 8px", fontSize: 9, borderRadius: 3, cursor: "pointer",
                            border: active ? `1px solid ${info.color}` : "1px solid hsl(220 13% 28%)",
                            background: active ? `${info.color}22` : "hsl(220 13% 20%)",
                            color: active ? info.color : "hsl(220 14% 50%)",
                          }}
                          title={info.description}
                        >
                          {info.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <input
                ref={nameInputRef}
                type="text"
                placeholder="Project name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateSubmit();
                  if (e.key === "Escape") setShowCreateForm(false);
                }}
                style={{
                  width: "100%", padding: "4px 8px", fontSize: 11, borderRadius: 4,
                  border: "1px solid hsl(220 13% 30%)", background: "hsl(220 13% 14%)",
                  color: "hsl(220 14% 85%)", outline: "none", boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                <button
                  onClick={handleCreateSubmit}
                  style={{
                    flex: 1, padding: "4px 8px", fontSize: 10, borderRadius: 4, cursor: "pointer",
                    border: "none", background: "hsl(207 90% 54%)", color: "#fff",
                  }}
                >
                  Create
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  style={{
                    flex: 1, padding: "4px 8px", fontSize: 10, borderRadius: 4, cursor: "pointer",
                    border: "1px solid hsl(220 13% 30%)", background: "transparent", color: "hsl(220 14% 55%)",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
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
          )}
        </div>
      )}
    </div>
  );
}
