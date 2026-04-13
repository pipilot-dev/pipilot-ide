/**
 * WikiTabView — renders a wiki page in an editor tab.
 * Uses react-markdown + remark-gfm for proper markdown rendering.
 * Mermaid diagrams are rendered via dynamic import.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useActiveProject } from "@/contexts/ProjectContext";
import { COLORS as C, FONTS } from "@/lib/design-tokens";

interface WikiTabViewProps {
  pageId: string;
}

// Initialize mermaid once globally
let mermaidInitialized = false;
async function getMermaid() {
  const m = (await import("mermaid")).default;
  if (!mermaidInitialized) {
    m.initialize({
      startOnLoad: false,
      theme: "dark",
      themeVariables: {
        darkMode: true,
        primaryColor: "#c6ff3d",
        primaryTextColor: "#e0e0e0",
        primaryBorderColor: "#444",
        lineColor: "#666",
        secondaryColor: "#1e293b",
        tertiaryColor: "#1a1a2e",
        background: "#0f1117",
        mainBkg: "#1a1a2e",
        nodeBorder: "#444",
      },
    });
    mermaidInitialized = true;
  }
  return m;
}

// Mermaid code block renderer — renders once, caches SVG
function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const renderedCodeRef = useRef<string>("");

  useEffect(() => {
    // Skip if already rendered this exact code
    if (renderedCodeRef.current === code && svg) return;
    renderedCodeRef.current = code;

    let cancelled = false;
    (async () => {
      try {
        const mermaid = await getMermaid();
        const id = `mermaid-${Math.random().toString(36).slice(2, 8)}`;
        const result = await mermaid.render(id, code);
        if (!cancelled) setSvg(result.svg);
      } catch (err: any) {
        if (!cancelled) setError(err.message?.slice(0, 120) || "Render failed");
      }
    })();
    return () => { cancelled = true; };
  }, [code]); // only re-run if the actual diagram code changes

  if (error) {
    return (
      <div style={{
        margin: "16px 0", padding: "12px 16px", borderRadius: 8,
        background: "hsl(0 30% 12%)", border: "1px solid hsl(0 40% 25%)",
        color: "hsl(0 60% 65%)", fontFamily: "monospace", fontSize: 11,
      }}>
        Diagram error: {error}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={{
        margin: "16px 0", padding: "16px",
        background: "hsl(220 13% 12%)", borderRadius: 8,
        border: "1px solid hsl(220 13% 22%)", overflowX: "auto",
        textAlign: "center",
        ...(svg ? {} : { color: "hsl(220 14% 45%)", fontSize: 11 }),
      }}
      {...(svg ? { dangerouslySetInnerHTML: { __html: svg } } : { children: "Loading diagram..." })}
    />
  );
}

// GitHub-style heading slug: "Home.tsx" → "hometsx"
function slugify(children: React.ReactNode): string {
  const text = typeof children === "string"
    ? children
    : Array.isArray(children)
      ? children.map((c) => (typeof c === "string" ? c : "")).join("")
      : String(children || "");
  return text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").trim();
}

export function WikiTabView({ pageId }: WikiTabViewProps) {
  const { activeProjectId } = useActiveProject();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(async () => {
    if (!activeProjectId || !pageId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/wiki/page?projectId=${encodeURIComponent(activeProjectId)}&pageId=${encodeURIComponent(pageId)}`,
      );
      if (res.ok) {
        const data = await res.json();
        setContent(data.content || "");
      } else {
        setContent(`# Page Not Found\n\nThe wiki page "${pageId}" does not exist yet.\n\nUse the **Generate Wiki** button in the Wiki panel to create documentation.`);
      }
    } catch {
      setContent("# Error\n\nFailed to load wiki page.");
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, pageId]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  if (loading) {
    return (
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        color: "hsl(220 14% 40%)", fontFamily: FONTS.mono, fontSize: 11,
      }}>
        <RefreshCw size={14} className="animate-spin" style={{ marginRight: 8 }} />
        Loading wiki page...
      </div>
    );
  }

  return (
    <div style={{
      flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden",
      background: C.bg, color: "hsl(220 14% 75%)",
    }}>
      <div ref={contentRef} style={{
        maxWidth: 820, margin: "0 auto", padding: "32px 40px 80px",
        fontFamily: FONTS.sans, fontSize: 14, lineHeight: 1.7,
      }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Headings — with id for anchor links (GitHub-style slug)
            h1: ({ children }) => {
              const slug = slugify(children);
              return <h1 id={slug} style={{ fontSize: 26, fontWeight: 700, color: "hsl(220 14% 95%)", margin: "0 0 16px", fontFamily: FONTS.display, lineHeight: 1.2 }}>{children}</h1>;
            },
            h2: ({ children }) => {
              const slug = slugify(children);
              return <h2 id={slug} style={{ fontSize: 20, fontWeight: 600, color: "hsl(220 14% 90%)", margin: "32px 0 12px", paddingBottom: 8, borderBottom: "1px solid hsl(220 13% 22%)" }}>{children}</h2>;
            },
            h3: ({ children }) => {
              const slug = slugify(children);
              return <h3 id={slug} style={{ fontSize: 16, fontWeight: 600, color: "hsl(220 14% 88%)", margin: "24px 0 8px" }}>{children}</h3>;
            },
            h4: ({ children }) => {
              const slug = slugify(children);
              return <h4 id={slug} style={{ fontSize: 14, fontWeight: 600, color: "hsl(220 14% 85%)", margin: "20px 0 6px" }}>{children}</h4>;
            },
            // Paragraphs
            p: ({ children }) => (
              <p style={{ margin: "10px 0", lineHeight: 1.75, color: "hsl(220 14% 72%)" }}>{children}</p>
            ),
            // Links — intercept anchors, .md wiki links, and file paths
            a: ({ href, children }) => {
              const h = href || "";
              // Anchor link (e.g. "#hometsx") — scroll to heading
              if (h.startsWith("#")) {
                return (
                  <a
                    href={h}
                    onClick={(e) => {
                      e.preventDefault();
                      const target = contentRef.current?.querySelector(`[id="${h.slice(1)}"]`);
                      target?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    style={{ color: C.accent, textDecoration: "none", borderBottom: `1px solid ${C.accent}40`, cursor: "pointer" }}
                  >
                    {children}
                  </a>
                );
              }
              // Wiki page link (e.g. "components.md", "architecture.md")
              if (h.endsWith(".md") && !h.startsWith("http")) {
                const wikiId = h.replace(/\.md$/, "").split("/").pop() || "";
                return (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      window.dispatchEvent(new CustomEvent("pipilot:open-wiki-page", {
                        detail: { pageId: wikiId, title: wikiId },
                      }));
                    }}
                    style={{ color: C.accent, textDecoration: "none", borderBottom: `1px solid ${C.accent}40`, cursor: "pointer" }}
                  >
                    {children}
                  </a>
                );
              }
              // Source file link (e.g. "src/components/MapView.tsx")
              if (/\.(tsx?|jsx?|css|json|html|py|go|rs)$/.test(h) && !h.startsWith("http")) {
                return (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      window.dispatchEvent(new CustomEvent("pipilot:open-file", {
                        detail: { filePath: h },
                      }));
                    }}
                    style={{ color: "hsl(207 80% 68%)", textDecoration: "none", borderBottom: "1px solid hsl(207 60% 40%)", cursor: "pointer", fontFamily: FONTS.mono, fontSize: "0.9em" }}
                  >
                    {children}
                  </a>
                );
              }
              // External link
              return (
                <a href={h} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: "none", borderBottom: `1px solid ${C.accent}40` }}>
                  {children}
                </a>
              );
            },
            // Bold
            strong: ({ children }) => (
              <strong style={{ color: "hsl(220 14% 88%)", fontWeight: 600 }}>{children}</strong>
            ),
            // Code blocks
            code: ({ className, children, ...props }) => {
              const match = /language-(\w+)/.exec(className || "");
              const lang = match?.[1] || "";
              const codeStr = String(children).replace(/\n$/, "");

              // Mermaid diagrams
              if (lang === "mermaid") {
                return <MermaidBlock code={codeStr} />;
              }

              // Block code (has language or is multiline)
              if (lang || codeStr.includes("\n")) {
                return (
                  <div style={{ margin: "12px 0", position: "relative" }}>
                    {lang && (
                      <div style={{
                        position: "absolute", top: 0, right: 0,
                        padding: "3px 10px", fontSize: 9, color: "hsl(220 14% 40%)",
                        fontFamily: FONTS.mono, textTransform: "uppercase", letterSpacing: "0.06em",
                      }}>
                        {lang}
                      </div>
                    )}
                    <pre style={{
                      background: "hsl(220 13% 11%)", border: "1px solid hsl(220 13% 22%)",
                      borderRadius: 6, padding: "14px 16px", overflowX: "auto",
                      fontSize: 12, lineHeight: 1.5, fontFamily: FONTS.mono,
                      color: "hsl(220 14% 78%)",
                    }}>
                      <code>{codeStr}</code>
                    </pre>
                  </div>
                );
              }

              // Inline code
              return (
                <code style={{
                  background: "hsl(220 13% 18%)", padding: "2px 6px", borderRadius: 3,
                  fontSize: "0.9em", color: "hsl(207 80% 70%)", fontFamily: FONTS.mono,
                }}>
                  {children}
                </code>
              );
            },
            // Tables (GFM)
            table: ({ children }) => (
              <div style={{ margin: "12px 0", overflowX: "auto" }}>
                <table style={{
                  width: "100%", borderCollapse: "collapse",
                  fontSize: 12, fontFamily: FONTS.mono,
                }}>
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => (
              <thead style={{ background: "hsl(220 13% 16%)" }}>{children}</thead>
            ),
            th: ({ children }) => (
              <th style={{
                padding: "8px 12px", textAlign: "left", fontSize: 10,
                color: "hsl(220 14% 60%)", fontWeight: 600,
                borderBottom: "2px solid hsl(220 13% 25%)",
                letterSpacing: "0.04em", textTransform: "uppercase",
              }}>{children}</th>
            ),
            td: ({ children }) => (
              <td style={{
                padding: "7px 12px", borderBottom: "1px solid hsl(220 13% 20%)",
                color: "hsl(220 14% 72%)",
              }}>{children}</td>
            ),
            // Lists
            ul: ({ children }) => (
              <ul style={{ margin: "8px 0", paddingLeft: 22, listStyle: "disc" }}>{children}</ul>
            ),
            ol: ({ children }) => (
              <ol style={{ margin: "8px 0", paddingLeft: 22 }}>{children}</ol>
            ),
            li: ({ children }) => (
              <li style={{ margin: "4px 0", lineHeight: 1.6 }}>{children}</li>
            ),
            // Blockquote
            blockquote: ({ children }) => (
              <blockquote style={{
                margin: "16px 0", padding: "12px 20px",
                borderLeft: `3px solid ${C.accent}`,
                background: `${C.accent}08`, borderRadius: "0 6px 6px 0",
                color: "hsl(220 14% 65%)", fontStyle: "italic",
              }}>
                {children}
              </blockquote>
            ),
            // Horizontal rule
            hr: () => (
              <hr style={{ border: "none", borderTop: "1px solid hsl(220 13% 22%)", margin: "24px 0" }} />
            ),
            // Images
            img: ({ src, alt }) => (
              <img src={src} alt={alt} style={{
                maxWidth: "100%", borderRadius: 8,
                border: "1px solid hsl(220 13% 22%)", margin: "12px 0",
              }} />
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
