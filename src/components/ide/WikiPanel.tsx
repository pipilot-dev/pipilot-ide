/**
 * WikiPanel — sidebar panel showing wiki sections with search.
 * Clicking an item opens the wiki page in an editor tab.
 * "Generate Wiki" button triggers the wiki-generator subagent.
 */

import { useState, useEffect, useCallback } from "react";
import {
  BookOpen, Search, RefreshCw, FileText, FolderOpen,
  ChevronRight, Loader2, Sparkles, Plus, Layout, Palette,
  GitBranch as ArchIcon, FileCode2, Layers,
} from "lucide-react";
import { useActiveProject } from "@/contexts/ProjectContext";
import { COLORS as C, FONTS } from "@/lib/design-tokens";
import { apiGet } from "@/lib/api";

interface WikiSection {
  id: string;
  title: string;
  path: string;
  size: number;
}

// Icon + color for each wiki section type
function getWikiIcon(id: string): { icon: React.ReactNode; color: string } {
  switch (id) {
    case "index": return { icon: <BookOpen size={12} />, color: C.accent };
    case "architecture": return { icon: <ArchIcon size={12} />, color: "#818cf8" };
    case "components": return { icon: <Layers size={12} />, color: "#06b6d4" };
    case "modules": return { icon: <Layers size={12} />, color: "#f59e0b" };
    case "pages": return { icon: <Layout size={12} />, color: "#f472b6" };
    case "design-system": return { icon: <Palette size={12} />, color: "#c084fc" };
    case "api": return { icon: <FileCode2 size={12} />, color: "#22c55e" };
    case "setup": return { icon: <FileText size={12} />, color: "#fb923c" };
    default: return { icon: <FileText size={12} />, color: "hsl(220 14% 50%)" };
  }
}

interface WikiPanelProps {
  activeTabId?: string | null;
}

export function WikiPanel({ activeTabId }: WikiPanelProps = {}) {
  const { activeProjectId } = useActiveProject();
  const [sections, setSections] = useState<WikiSection[]>([]);
  const [wikiExists, setWikiExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [generating, setGenerating] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeProjectId) return;
    setLoading(true);
    try {
      const data = await apiGet("/api/wiki/tree", { projectId: activeProjectId });
      setSections(data.sections || []);
      setWikiExists(data.exists);
    } catch {} finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll for updates while generating
  useEffect(() => {
    if (!generating) return;
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [generating, refresh]);

  const openWikiPage = (section: WikiSection) => {
    window.dispatchEvent(new CustomEvent("pipilot:open-wiki-page", {
      detail: { pageId: section.id, title: section.title },
    }));
  };

  const generateWiki = async () => {
    setGenerating(true);
    window.dispatchEvent(new CustomEvent("pipilot:open-chat"));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("pipilot:focus-chat-input", {
        detail: {
          prefill: "Use the wiki-generator agent to scan this project and generate comprehensive documentation. Create an index.md with project overview and architecture diagrams, plus separate pages for key modules, components, and API routes. Store everything in .pipilot/wikis/.",
          submit: true,
        },
      }));
    }, 200);
    // Stop the generating indicator after 2 minutes max
    setTimeout(() => setGenerating(false), 120000);
  };

  const filtered = sections.filter((s) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return s.title.toLowerCase().includes(q) || s.id.includes(q);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", color: "hsl(220 14% 75%)", fontFamily: FONTS.sans }}>
      {/* Header */}
      <div style={{
        padding: "8px 12px", display: "flex", alignItems: "center", gap: 8,
        borderBottom: "1px solid hsl(220 13% 22%)",
      }}>
        <BookOpen size={13} style={{ color: C.accent }} />
        <span style={{ fontWeight: 600, fontSize: 11, fontFamily: FONTS.mono, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Wiki
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={refresh}
          title="Refresh"
          style={{ background: "none", border: "none", color: "hsl(220 14% 50%)", cursor: "pointer", padding: 2, display: "flex" }}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: "8px 10px" }}>
        <div style={{ position: "relative" }}>
          <Search size={11} style={{ position: "absolute", left: 8, top: 7, color: "hsl(220 14% 40%)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search wiki..."
            style={{
              width: "100%", padding: "5px 8px 5px 26px",
              background: "hsl(220 13% 18%)", border: "1px solid hsl(220 13% 26%)",
              borderRadius: 4, color: "hsl(220 14% 85%)", fontSize: 11,
              fontFamily: FONTS.mono, outline: "none",
            }}
          />
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
        {!wikiExists && !loading ? (
          /* No wiki yet — show generate prompt */
          <div style={{ padding: "20px 8px", textAlign: "center" }}>
            <BookOpen size={32} style={{ color: "hsl(220 14% 30%)", margin: "0 auto 12px" }} />
            <div style={{ fontSize: 12, color: "hsl(220 14% 55%)", marginBottom: 4 }}>
              No wiki generated yet
            </div>
            <div style={{ fontSize: 10, color: "hsl(220 14% 40%)", marginBottom: 16, lineHeight: 1.5 }}>
              Generate AI-powered documentation for your project including architecture diagrams, module docs, and API references.
            </div>
            <button
              onClick={generateWiki}
              disabled={generating}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 5,
                background: C.accent, color: "hsl(220 13% 10%)",
                border: "none", cursor: "pointer",
                fontFamily: FONTS.mono, fontSize: 10, fontWeight: 600,
                letterSpacing: "0.04em",
              }}
            >
              {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {generating ? "Generating..." : "Generate Wiki"}
            </button>
          </div>
        ) : (
          /* Wiki sections list */
          <>
            {filtered.length === 0 && !loading && (
              <div style={{ padding: 16, textAlign: "center", color: "hsl(220 14% 40%)", fontSize: 11 }}>
                {filter ? "No matching pages" : "Wiki is empty"}
              </div>
            )}

            {filtered.map((section) => {
              const { icon, color } = getWikiIcon(section.id);
              const isActive = activeTabId === `__wiki__${section.id}`;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => openWikiPage(section)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8,
                    padding: "7px 10px", margin: "2px 0", borderRadius: 4,
                    background: isActive ? `${color}12` : "transparent",
                    border: isActive ? `1px solid ${color}30` : "1px solid transparent",
                    color: isActive ? color : "hsl(220 14% 72%)",
                    fontFamily: FONTS.sans, fontSize: 11,
                    cursor: "pointer", textAlign: "left",
                    transition: "all 0.12s",
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "hsl(220 13% 20%)"; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ color, flexShrink: 0 }}>{icon}</span>
                  <span style={{
                    flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontWeight: isActive ? 600 : 400,
                  }}>
                    {section.title}
                  </span>
                  <span style={{ fontSize: 8, color: "hsl(220 14% 35%)", fontFamily: FONTS.mono, flexShrink: 0 }}>
                    {(section.size / 1024).toFixed(1)}K
                  </span>
                  {isActive && <span style={{ width: 4, height: 4, borderRadius: 4, background: color, flexShrink: 0 }} />}
                </button>
              );
            })}

            {/* Regenerate / Add page buttons */}
            <div style={{ display: "flex", gap: 4, marginTop: 8, padding: "0 2px" }}>
              <button
                onClick={generateWiki}
                disabled={generating}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                  padding: "6px 8px", borderRadius: 4,
                  background: "transparent", border: `1px dashed hsl(220 13% 28%)`,
                  color: generating ? C.accent : "hsl(220 14% 45%)",
                  fontFamily: FONTS.mono, fontSize: 9, cursor: "pointer",
                }}
              >
                {generating ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                {generating ? "Generating..." : "Regenerate"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
