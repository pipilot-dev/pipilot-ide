/**
 * FileViewer — rich preview for non-text files (and dual-mode for markdown / SVG).
 *
 * Detects the file type by extension and renders the appropriate viewer:
 *   - image (png/jpg/gif/webp/avif/bmp/ico)  → <img> with checker bg + zoom
 *   - svg                                    → view ↔ code toggle
 *   - markdown                               → view ↔ code toggle (default view)
 *   - video                                  → <video controls>
 *   - audio                                  → <audio controls>
 *   - pdf                                    → <iframe> embed
 *   - docx / doc / xlsx                      → "open externally" notice
 *   - other binary                           → "binary file" notice with download
 *
 * Reads the file from /api/files/raw which streams with the right Content-Type.
 */

import React, { useState, useMemo, useEffect } from "react";
import {
  Code2, Eye, Image as ImageIcon, FileVideo, FileAudio,
  FileText as FileTextIcon, FileQuestion, Download, ZoomIn, ZoomOut, RotateCw,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";
import { useActiveProject } from "@/contexts/ProjectContext";

interface FileViewerProps {
  /** Workspace-relative path of the file (also the FileNode id). */
  filePath: string;
  /** File name (used for the header label). */
  fileName: string;
  /** UTF-8 file content (for text-based viewers like markdown / svg). */
  content?: string;
  /** Render Monaco fallback when the user toggles back to "code" mode. */
  renderCodeFallback?: () => React.ReactNode;
}

type ViewerKind =
  | "image" | "svg" | "video" | "audio"
  | "pdf" | "office" | "markdown" | "html"
  | "binary" | "unknown";

function detectViewerKind(name: string): ViewerKind {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"].includes(ext)) return "image";
  if (ext === "svg") return "svg";
  if (["mp4", "webm", "ogv", "mov", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "flac", "aac"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) return "office";
  if (["md", "mdx", "markdown"].includes(ext)) return "markdown";
  if (["html", "htm"].includes(ext)) return "html";
  return "unknown";
}

/**
 * Decide whether the FileViewer should handle a given file (vs. Monaco).
 * EditorArea uses this as the routing predicate.
 */
export function shouldUseFileViewer(name: string): boolean {
  const kind = detectViewerKind(name);
  return kind !== "unknown";
}

export function FileViewer({ filePath, fileName, content, renderCodeFallback }: FileViewerProps) {
  useEffect(() => { injectFonts(); }, []);
  const { activeProjectId } = useActiveProject();
  const kind = useMemo(() => detectViewerKind(fileName), [fileName]);
  // Toggle: markdown defaults to "view", svg defaults to "view"
  const [mode, setMode] = useState<"view" | "code">(
    kind === "markdown" || kind === "svg" ? "view" : "view",
  );
  const [imgZoom, setImgZoom] = useState(1);
  const [imgRotate, setImgRotate] = useState(0);

  const rawUrl = useMemo(
    () => `/api/files/raw?projectId=${encodeURIComponent(activeProjectId || "")}&path=${encodeURIComponent(filePath)}`,
    [activeProjectId, filePath],
  );

  const isDualMode = kind === "markdown" || kind === "svg" || kind === "html";

  return (
    <div style={{
      flex: 1, minHeight: 0,
      display: "flex", flexDirection: "column",
      background: C.bg,
      fontFamily: FONTS.sans,
      color: C.text,
    }}>
      {/* ── Toolbar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "8px 16px",
        borderBottom: `1px solid ${C.border}`,
        background: C.surface,
        flexShrink: 0,
      }}>
        <span style={{
          fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
          letterSpacing: "0.18em", textTransform: "uppercase",
          color: C.accent,
        }}>
          / {kindLabel(kind)}
        </span>
        <span style={{
          fontFamily: FONTS.mono, fontSize: 10,
          color: C.textMid,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          flex: 1, minWidth: 0,
        }}>
          {filePath}
        </span>

        {/* Image controls */}
        {kind === "image" && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <ToolbarBtn icon={<ZoomOut size={11} />} title="Zoom out" onClick={() => setImgZoom((z) => Math.max(0.1, z - 0.2))} />
            <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: C.textDim, minWidth: 36, textAlign: "center" }}>
              {Math.round(imgZoom * 100)}%
            </span>
            <ToolbarBtn icon={<ZoomIn size={11} />} title="Zoom in" onClick={() => setImgZoom((z) => Math.min(8, z + 0.2))} />
            <ToolbarBtn icon={<RotateCw size={11} />} title="Rotate" onClick={() => setImgRotate((r) => (r + 90) % 360)} />
            <ToolbarBtn label="reset" onClick={() => { setImgZoom(1); setImgRotate(0); }} />
          </div>
        )}

        {/* Dual-mode toggle (markdown / svg) */}
        {isDualMode && (
          <div style={{ display: "flex", gap: 0, border: `1px solid ${C.border}`, borderRadius: 3, overflow: "hidden" }}>
            <ModeBtn icon={<Eye size={10} />} label="View" active={mode === "view"} onClick={() => setMode("view")} />
            <ModeBtn icon={<Code2 size={10} />} label="Code" active={mode === "code"} onClick={() => setMode("code")} />
          </div>
        )}

        {/* Download */}
        <a
          href={rawUrl}
          download={fileName}
          title="Download"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 26, height: 22,
            borderRadius: 3,
            color: C.textDim,
            textDecoration: "none",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.color = C.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textDim; }}
        >
          <Download size={11} />
        </a>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflow: "auto", minHeight: 0, position: "relative" }}>
        {kind === "image" && (
          <div style={checkerStyle}>
            <img
              src={rawUrl}
              alt={fileName}
              style={{
                maxWidth: "100%",
                transform: `scale(${imgZoom}) rotate(${imgRotate}deg)`,
                transformOrigin: "center",
                transition: "transform 0.18s ease",
                imageRendering: imgZoom >= 4 ? "pixelated" : "auto",
              }}
            />
          </div>
        )}

        {kind === "svg" && mode === "view" && (
          <div style={checkerStyle}>
            <img
              src={rawUrl}
              alt={fileName}
              style={{
                maxWidth: "min(80%, 600px)",
                maxHeight: "80%",
              }}
            />
          </div>
        )}

        {kind === "svg" && mode === "code" && renderCodeFallback?.()}

        {kind === "video" && (
          <div style={mediaWrapStyle}>
            <video src={rawUrl} controls style={{ maxWidth: "100%", maxHeight: "100%", outline: "none" }}>
              Your browser doesn't support this video format.
            </video>
          </div>
        )}

        {kind === "audio" && (
          <div style={{ ...mediaWrapStyle, gap: 16, flexDirection: "column" }}>
            <FileAudio size={48} style={{ color: C.textDim }} />
            <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: C.textMid }}>{fileName}</div>
            <audio src={rawUrl} controls style={{ width: "min(90%, 480px)" }}>
              Your browser doesn't support this audio format.
            </audio>
          </div>
        )}

        {kind === "pdf" && (
          <iframe
            src={rawUrl}
            title={fileName}
            style={{ width: "100%", height: "100%", border: "none", background: C.bg }}
          />
        )}

        {kind === "markdown" && mode === "view" && (
          <div style={{ ...markdownWrap, fontFamily: FONTS.sans, fontSize: 14, lineHeight: 1.7, color: "hsl(220 14% 75%)" }} className="pipilot-markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h1 style={{ fontSize: 26, fontWeight: 700, color: "hsl(220 14% 95%)", margin: "0 0 16px", fontFamily: FONTS.display }}>{children}</h1>,
                h2: ({ children }) => <h2 style={{ fontSize: 20, fontWeight: 600, color: "hsl(220 14% 90%)", margin: "28px 0 10px", paddingBottom: 8, borderBottom: "1px solid hsl(220 13% 22%)" }}>{children}</h2>,
                h3: ({ children }) => <h3 style={{ fontSize: 16, fontWeight: 600, color: "hsl(220 14% 88%)", margin: "22px 0 8px" }}>{children}</h3>,
                h4: ({ children }) => <h4 style={{ fontSize: 14, fontWeight: 600, color: "hsl(220 14% 85%)", margin: "18px 0 6px" }}>{children}</h4>,
                p: ({ children }) => <p style={{ margin: "10px 0", lineHeight: 1.75 }}>{children}</p>,
                strong: ({ children }) => <strong style={{ color: "hsl(220 14% 88%)", fontWeight: 600 }}>{children}</strong>,
                a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: C.accent, textDecoration: "none" }}>{children}</a>,
                blockquote: ({ children }) => <blockquote style={{ margin: "16px 0", padding: "12px 20px", borderLeft: `3px solid ${C.accent}`, background: `${C.accent}08`, borderRadius: "0 6px 6px 0", fontStyle: "italic" }}>{children}</blockquote>,
                hr: () => <hr style={{ border: "none", borderTop: "1px solid hsl(220 13% 22%)", margin: "20px 0" }} />,
                ul: ({ children }) => <ul style={{ margin: "8px 0", paddingLeft: 22, listStyle: "disc" }}>{children}</ul>,
                ol: ({ children }) => <ol style={{ margin: "8px 0", paddingLeft: 22 }}>{children}</ol>,
                li: ({ children }) => <li style={{ margin: "4px 0", lineHeight: 1.6 }}>{children}</li>,
                table: ({ children }) => <div style={{ margin: "12px 0", overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: FONTS.mono }}>{children}</table></div>,
                thead: ({ children }) => <thead style={{ background: "hsl(220 13% 16%)" }}>{children}</thead>,
                th: ({ children }) => <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, color: "hsl(220 14% 60%)", fontWeight: 600, borderBottom: "2px solid hsl(220 13% 25%)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{children}</th>,
                td: ({ children }) => <td style={{ padding: "7px 12px", borderBottom: "1px solid hsl(220 13% 20%)" }}>{children}</td>,
                img: ({ src, alt }) => <img src={src} alt={alt} style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid hsl(220 13% 22%)", margin: "12px 0" }} />,
                code: ({ className, children }) => {
                  const lang = /language-(\w+)/.exec(className || "")?.[1] || "";
                  const codeStr = String(children).replace(/\n$/, "");
                  if (lang === "mermaid") {
                    // Lazy-load MermaidBlock from WikiTabView
                    const MermaidLazy = ({ code: c }: { code: string }) => {
                      const mRef = React.useRef<HTMLDivElement>(null);
                      const [svg, setSvg] = React.useState<string | null>(null);
                      const [err, setErr] = React.useState<string | null>(null);
                      React.useEffect(() => {
                        let x = false;
                        (async () => {
                          try {
                            const m = (await import("mermaid")).default;
                            m.initialize({ startOnLoad: false, theme: "dark", themeVariables: { darkMode: true, primaryColor: "#c6ff3d", primaryTextColor: "#e0e0e0", lineColor: "#666", background: "#0f1117", mainBkg: "#1a1a2e" } });
                            const { svg: s } = await m.render(`md-${Math.random().toString(36).slice(2)}`, c);
                            if (!x) setSvg(s);
                          } catch (e: any) { if (!x) setErr(e.message?.slice(0, 100)); }
                        })();
                        return () => { x = true; };
                      }, [c]);
                      if (err) return <div style={{ padding: 12, background: "hsl(0 30% 12%)", border: "1px solid hsl(0 40% 25%)", borderRadius: 6, color: "hsl(0 60% 65%)", fontSize: 11, fontFamily: "monospace" }}>Diagram error: {err}</div>;
                      return <div ref={mRef} style={{ margin: "16px 0", padding: 16, background: "hsl(220 13% 12%)", borderRadius: 8, border: "1px solid hsl(220 13% 22%)", overflowX: "auto", textAlign: "center" }} {...(svg ? { dangerouslySetInnerHTML: { __html: svg } } : { children: "Loading diagram..." })} />;
                    };
                    return <MermaidLazy code={codeStr} />;
                  }
                  if (lang || codeStr.includes("\n")) {
                    return <pre style={{ background: "hsl(220 13% 11%)", border: "1px solid hsl(220 13% 22%)", borderRadius: 6, padding: "14px 16px", overflowX: "auto", fontSize: 12, lineHeight: 1.5, fontFamily: FONTS.mono, color: "hsl(220 14% 78%)", margin: "12px 0" }}><code>{codeStr}</code></pre>;
                  }
                  return <code style={{ background: "hsl(220 13% 18%)", padding: "2px 6px", borderRadius: 3, fontSize: "0.9em", color: "hsl(207 80% 70%)", fontFamily: FONTS.mono }}>{children}</code>;
                },
              }}
            >
              {content || "*(empty document)*"}
            </ReactMarkdown>
          </div>
        )}

        {kind === "markdown" && mode === "code" && renderCodeFallback?.()}

        {kind === "html" && mode === "view" && (
          <iframe
            // Sandbox: allow scripts/styles/forms but block top navigation and
            // same-origin so the rendered page can't reach into the IDE.
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            srcDoc={content || "<!DOCTYPE html><html><body><p style='color:#5e5e68;font-family:monospace;padding:20px'>// empty document</p></body></html>"}
            title={fileName}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              background: "#ffffff",
            }}
          />
        )}

        {kind === "html" && mode === "code" && renderCodeFallback?.()}

        {kind === "office" && (
          <BinaryNotice
            icon={<FileTextIcon size={32} />}
            title="Office document"
            message="Inline preview for .docx / .xlsx / .pptx isn't supported yet. Download to view in your office app."
            url={rawUrl}
            fileName={fileName}
          />
        )}

        {kind === "binary" && (
          <BinaryNotice
            icon={<FileQuestion size={32} />}
            title="Binary file"
            message="This file type isn't text. Download it to view externally."
            url={rawUrl}
            fileName={fileName}
          />
        )}

        {kind === "unknown" && renderCodeFallback?.()}
      </div>

      <style>{`
        .pipilot-markdown {
          font-family: ${FONTS.sans};
          font-size: 14px;
          line-height: 1.7;
          color: ${C.text};
        }
        .pipilot-markdown h1, .pipilot-markdown h2, .pipilot-markdown h3 {
          font-family: ${FONTS.display};
          font-weight: 400;
          color: ${C.text};
          margin-top: 1.4em;
          margin-bottom: 0.5em;
          line-height: 1.1;
        }
        .pipilot-markdown h1 { font-size: 38px; }
        .pipilot-markdown h2 { font-size: 28px; }
        .pipilot-markdown h3 { font-size: 22px; }
        .pipilot-markdown h4, .pipilot-markdown h5, .pipilot-markdown h6 {
          font-family: ${FONTS.sans};
          font-weight: 600;
          color: ${C.text};
          margin-top: 1.2em;
          margin-bottom: 0.4em;
        }
        .pipilot-markdown p { margin: 0 0 1em; color: ${C.textMid}; }
        .pipilot-markdown a {
          color: ${C.accent};
          text-decoration: none;
          border-bottom: 1px solid ${C.accentLine};
        }
        .pipilot-markdown a:hover { border-bottom-color: ${C.accent}; }
        .pipilot-markdown code {
          font-family: ${FONTS.mono};
          font-size: 12px;
          padding: 1px 6px;
          background: ${C.surfaceAlt};
          border: 1px solid ${C.border};
          border-radius: 3px;
          color: ${C.accent};
        }
        .pipilot-markdown pre {
          background: ${C.surface};
          border: 1px solid ${C.border};
          border-radius: 4px;
          padding: 14px 16px;
          overflow-x: auto;
          margin: 1em 0;
        }
        .pipilot-markdown pre code {
          padding: 0;
          background: transparent;
          border: none;
          color: ${C.text};
          font-size: 12px;
        }
        .pipilot-markdown blockquote {
          border-left: 2px solid ${C.accentLine};
          padding: 4px 16px;
          margin: 1em 0;
          color: ${C.textMid};
          font-style: italic;
        }
        .pipilot-markdown ul, .pipilot-markdown ol { padding-left: 24px; margin: 0 0 1em; color: ${C.textMid}; }
        .pipilot-markdown li { margin: 4px 0; }
        .pipilot-markdown hr { border: none; border-top: 1px solid ${C.border}; margin: 2em 0; }
        .pipilot-markdown table {
          border-collapse: collapse;
          margin: 1em 0;
          font-size: 13px;
        }
        .pipilot-markdown th, .pipilot-markdown td {
          padding: 8px 14px;
          border: 1px solid ${C.border};
          text-align: left;
        }
        .pipilot-markdown th { background: ${C.surfaceAlt}; color: ${C.text}; }
        .pipilot-markdown img { max-width: 100%; border-radius: 4px; }
      `}</style>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

function kindLabel(k: ViewerKind): string {
  switch (k) {
    case "image": return "IMAGE";
    case "svg": return "SVG";
    case "video": return "VIDEO";
    case "audio": return "AUDIO";
    case "pdf": return "PDF";
    case "office": return "OFFICE";
    case "markdown": return "MARKDOWN";
    case "html": return "HTML";
    case "binary": return "BINARY";
    default: return "FILE";
  }
}

function ToolbarBtn({ icon, label, title, onClick }: {
  icon?: React.ReactNode; label?: string; title?: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title || label}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
        padding: label ? "3px 8px" : 0,
        width: label ? undefined : 22, height: 22,
        background: "transparent",
        border: `1px solid ${C.border}`,
        borderRadius: 3,
        color: C.textDim,
        cursor: "pointer",
        fontFamily: FONTS.mono, fontSize: 9,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accentLine; e.currentTarget.style.color = C.accent; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textDim; }}
    >
      {icon}
      {label}
    </button>
  );
}

function ModeBtn({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "4px 10px",
        background: active ? C.accentDim : "transparent",
        color: active ? C.accent : C.textDim,
        border: "none",
        cursor: "pointer",
        fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
        letterSpacing: "0.1em", textTransform: "uppercase",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = C.text; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = C.textDim; }}
    >
      {icon}
      {label}
    </button>
  );
}

function BinaryNotice({ icon, title, message, url, fileName }: {
  icon: React.ReactNode; title: string; message: string; url: string; fileName: string;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 16, padding: 60,
      height: "100%",
      color: C.textMid, textAlign: "center",
    }}>
      <div style={{ color: C.textDim }}>{icon}</div>
      <div style={{
        fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
        letterSpacing: "0.18em", textTransform: "uppercase",
        color: C.textDim,
      }}>// {title}</div>
      <div style={{ fontFamily: FONTS.sans, fontSize: 13, maxWidth: 380, lineHeight: 1.6 }}>
        {message}
      </div>
      <a
        href={url}
        download={fileName}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 20px",
          fontFamily: FONTS.mono, fontSize: 10, fontWeight: 600,
          letterSpacing: "0.12em", textTransform: "uppercase",
          background: C.accent,
          color: C.bg,
          border: `1px solid ${C.accent}`,
          borderRadius: 3,
          textDecoration: "none",
          marginTop: 4,
        }}
      >
        <Download size={11} />
        Download
      </a>
    </div>
  );
}

const checkerStyle: React.CSSProperties = {
  width: "100%", height: "100%",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 20,
  background: `
    linear-gradient(45deg, #15151b 25%, transparent 25%),
    linear-gradient(-45deg, #15151b 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #15151b 75%),
    linear-gradient(-45deg, transparent 75%, #15151b 75%)
  `,
  backgroundSize: "20px 20px",
  backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
};

const mediaWrapStyle: React.CSSProperties = {
  width: "100%", height: "100%",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 20,
  background: C.bg,
};

const markdownWrap: React.CSSProperties = {
  maxWidth: 820,
  margin: "0 auto",
  padding: "40px 56px 80px",
};
