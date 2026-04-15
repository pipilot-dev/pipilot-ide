import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDown, Plus, Check, FolderOpen, Trash2, X, Link2 } from "lucide-react";
import { useProjects } from "@/hooks/useProjects";
import { useNotifications } from "@/contexts/NotificationContext";
import { TEMPLATE_INFO, type ProjectTemplate } from "@/lib/project-templates";
import { PartialDeleteDialog } from "./PartialDeleteDialog";

export function ProjectSwitcher() {
  const { projects, activeProject, createProject, switchProject, deleteProject, closeProject } = useProjects();
  const { addNotification, showToast } = useNotifications();
  // State for the partial-delete dialog (folder couldn't be removed)
  const [partialDelete, setPartialDelete] = useState<
    { path: string; message: string; leftoverCount: number } | null
  >(null);
  const [open, setOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectType, setNewProjectType] = useState<"static" | "nodebox" | "cloud">("static");
  const [newProjectTemplate, setNewProjectTemplate] = useState<ProjectTemplate>("static");
  const [slugPreview, setSlugPreview] = useState("");
  const [slugTaken, setSlugTaken] = useState(false);
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
      {/* Partial-delete dialog: shown when the disk folder is locked */}
      <PartialDeleteDialog
        open={!!partialDelete}
        path={partialDelete?.path || ""}
        message={partialDelete?.message}
        leftoverCount={partialDelete?.leftoverCount}
        onClose={() => setPartialDelete(null)}
      />

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
        <span className="truncate" style={{ maxWidth: 100 }}>
          {(activeProject?.name ?? "No Project").length > 12 ? (activeProject?.name ?? "No Project").slice(0, 12) + "…" : (activeProject?.name ?? "No Project")}
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
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left transition-colors group"
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
                  <span className="truncate flex-1">{project.name}</span>
                  {project.type === "linked" && (
                    <span
                      title={project.linkedPath || ""}
                      style={{
                        fontSize: 8, padding: "1px 4px", borderRadius: 3, marginLeft: 4,
                        background: "hsl(47 95% 55% / 0.18)",
                        color: "hsl(47 95% 60%)",
                        display: "inline-flex", alignItems: "center", gap: 3,
                      }}
                    >
                      <Link2 size={8} /> Linked
                    </span>
                  )}
                  {project.type && project.type !== "static" && project.type !== "linked" && (
                    <span style={{
                      fontSize: 8, padding: "1px 4px", borderRadius: 3, marginLeft: 4,
                      background: project.type === "cloud" ? "hsl(280 65% 55% / 0.2)" : "hsl(142 71% 45% / 0.2)",
                      color: project.type === "cloud" ? "hsl(280 65% 60%)" : "hsl(142 71% 45%)",
                    }}>
                      {project.type === "cloud" ? "Cloud" : "Node"}
                    </span>
                  )}
                  {projects.length > 1 && (
                    <span
                      className="opacity-0 group-hover:opacity-100 flex-shrink-0"
                      style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
                    >
                      {/* Close (X) — keeps files on disk. Shown for linked AND
                          AI-scaffolded (nodebox/cloud) projects. Static projects
                          have no on-disk files, so this button is hidden — only
                          the red trash shows, which is effectively a close. */}
                      {(project.type === "linked" || project.type === "nodebox" || project.type === "cloud") && (
                        <span
                          title={
                            project.type === "linked"
                              ? "Close linked folder (files on disk are kept)"
                              : "Close project (keeps files in workspaces/ on disk)"
                          }
                          onClick={async (e) => {
                            e.stopPropagation();
                            const confirmMsg = project.type === "linked"
                              ? `Close linked folder "${project.name}"?\n\nThis only removes the link — the files on disk will NOT be deleted.`
                              : `Close "${project.name}"?\n\nThe project will be removed from this list, but its files will be kept in workspaces/ on disk.`;
                            if (!confirm(confirmMsg)) return;
                            showToast({ type: "info", title: `Closing ${project.name}…` });
                            try {
                              await closeProject(project.id);
                              addNotification({
                                type: "success",
                                title: project.type === "linked" ? "Folder closed" : "Project closed",
                                message: project.type === "linked"
                                  ? `${project.name} unlinked — files kept on disk`
                                  : `${project.name} — files kept in workspaces/`,
                              });
                            } catch (err) {
                              console.error("[close project] failed:", err);
                              addNotification({
                                type: "error",
                                title: "Close failed",
                                message: err instanceof Error ? err.message : String(err),
                              });
                            }
                          }}
                          style={{
                            color: "hsl(47 95% 60%)",
                            padding: "0 2px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          <X size={12} />
                        </span>
                      )}

                      {/* Delete (Trash) — wipes files on disk. Hidden for
                          linked projects (we never delete the user's own
                          files). Shown for static/nodebox/cloud. */}
                      {project.type !== "linked" && (
                        <span
                          title="Delete project (removes files on disk)"
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm(`Delete "${project.name}"?\n\nThis PERMANENTLY removes the project and all its files on disk.`)) return;
                            showToast({ type: "info", title: `Deleting ${project.name}…` });
                            try {
                              const result = await deleteProject(project.id);
                              if (result && (result as any).partial) {
                                const r = result as any;
                                addNotification({
                                  type: "warning",
                                  title: "Folder needs manual removal",
                                  message: `${project.name} was cleared but the folder is locked.`,
                                  silent: true,
                                });
                                setPartialDelete({
                                  path: r.path,
                                  message: r.message,
                                  leftoverCount: r.leftoverCount || 0,
                                });
                              } else {
                                addNotification({
                                  type: "success",
                                  title: "Project deleted",
                                  message: project.name,
                                });
                              }
                            } catch (err) {
                              console.error("[delete project] failed:", err);
                              addNotification({
                                type: "error",
                                title: "Delete failed",
                                message: err instanceof Error ? err.message : String(err),
                              });
                            }
                          }}
                          style={{
                            color: "hsl(0 84% 60%)",
                            padding: "0 2px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                        >
                          <Trash2 size={11} />
                        </span>
                      )}
                    </span>
                  )}
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
                onChange={(e) => {
                  const val = e.target.value;
                  setNewProjectName(val);
                  const slug = val.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
                  setSlugPreview(slug);
                  if (slug) {
                    const taken = projects.some(p => p.id === slug);
                    setSlugTaken(taken);
                  } else {
                    setSlugTaken(false);
                  }
                }}
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
              {slugPreview && (
                <div style={{ fontSize: 9, marginTop: 3, color: slugTaken ? "hsl(0 84% 60%)" : "hsl(220 14% 45%)" }}>
                  {slugTaken ? `"${slugPreview}" is taken — will append suffix` : `→ ${slugPreview}`}
                </div>
              )}
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
