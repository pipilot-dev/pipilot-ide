/**
 * FolderPicker — editorial-terminal styled disk-folder browser.
 * Used for File → Open Folder.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Folder, ChevronLeft, Home, HardDrive, Loader2, X,
  Check, Package, ChevronRight,
} from "lucide-react";
import { COLORS as C, FONTS, injectFonts } from "@/lib/design-tokens";

interface FolderPickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (absolutePath: string) => void | Promise<void>;
}

interface FsEntry { name: string; path: string; hasPackageJson?: boolean }
interface FsListing {
  path: string;
  parent: string | null;
  folders: FsEntry[];
  separator: string;
}
interface HomeInfo {
  home: string;
  separator: string;
  entries: { name: string; path: string }[];
}

export function FolderPicker({ open, onClose, onPick }: FolderPickerProps) {
  const [home, setHome] = useState<HomeInfo | null>(null);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => { injectFonts(); }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setListing(null);
    fetch("/api/fs/home")
      .then((r) => r.json())
      .then((data: HomeInfo) => {
        setHome(data);
        loadPath(data.home);
      })
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadPath = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fs/list?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data: FsListing = await res.json();
      setListing(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePick = async () => {
    if (!listing) return;
    setPicking(true);
    try {
      await onPick(listing.path);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to open folder");
    } finally {
      setPicking(false);
    }
  };

  if (!open) return null;

  // Breadcrumbs from current path
  const sep = listing?.separator || "/";
  const breadcrumbs: { name: string; path: string }[] = [];
  if (listing) {
    const parts = listing.path.split(sep).filter(Boolean);
    let cumulative = listing.path.startsWith(sep) ? sep : "";
    for (let i = 0; i < parts.length; i++) {
      cumulative = i === 0 && !listing.path.startsWith(sep)
        ? parts[0] + (parts.length > 1 ? sep : "")
        : cumulative + parts[i] + (i < parts.length - 1 ? sep : "");
      breadcrumbs.push({ name: parts[i], path: cumulative });
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: FONTS.sans,
      }}
    >
      <div style={{
        width: 760, height: 560,
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 10, overflow: "hidden",
        boxShadow: "0 24px 64px rgba(0, 0, 0, 0.7)",
        display: "flex", flexDirection: "column",
        position: "relative",
      }}>
        {/* Faint accent glow */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -120, right: -120,
            width: 320, height: 320,
            background: `radial-gradient(circle, ${C.accent}10 0%, transparent 70%)`,
            pointerEvents: "none",
          }}
        />

        {/* ── Header — editorial label + display title ── */}
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          padding: "22px 28px 18px",
          borderBottom: `1px solid ${C.border}`,
          position: "relative",
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span style={{
                fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
                letterSpacing: "0.18em", textTransform: "uppercase", color: C.accent,
              }}>
                / FS
              </span>
              <span style={{
                fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
                letterSpacing: "0.18em", textTransform: "uppercase", color: C.textDim,
              }}>
                Open Folder
              </span>
            </div>
            <h3 style={{
              fontFamily: FONTS.display, fontSize: 28, fontWeight: 400,
              lineHeight: 1, color: C.text, margin: 0,
            }}>
              choose a <span style={{ fontStyle: "italic", color: C.accent }}>folder</span>
              <span style={{ color: C.accent }}>.</span>
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none",
              color: C.textDim, cursor: "pointer", padding: 6,
              borderRadius: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.surfaceAlt; e.currentTarget.style.color = C.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textDim; }}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Breadcrumb bar ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "10px 18px",
          background: C.surfaceAlt,
          borderBottom: `1px solid ${C.border}`,
          minHeight: 38,
        }}>
          <button
            disabled={!listing?.parent}
            onClick={() => listing?.parent && loadPath(listing.parent)}
            style={{
              background: "none", border: "none",
              color: listing?.parent ? C.textMid : C.textFaint,
              cursor: listing?.parent ? "pointer" : "not-allowed",
              padding: 4, display: "flex", alignItems: "center",
              borderRadius: 3,
            }}
            onMouseEnter={(e) => {
              if (listing?.parent) { e.currentTarget.style.background = C.surface; e.currentTarget.style.color = C.accent; }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = listing?.parent ? C.textMid : C.textFaint;
            }}
            title="Go up"
          >
            <ChevronLeft size={14} />
          </button>
          <div style={{
            flex: 1, display: "flex", alignItems: "center", gap: 2,
            fontSize: 11, fontFamily: FONTS.mono,
            color: C.textMid,
            overflow: "hidden",
          }}>
            {breadcrumbs.length > 0 ? breadcrumbs.map((bc, i) => (
              <span key={bc.path} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                {i > 0 && <ChevronRight size={9} style={{ color: C.textFaint, flexShrink: 0 }} />}
                <button
                  onClick={() => loadPath(bc.path)}
                  style={{
                    background: "none", border: "none",
                    color: i === breadcrumbs.length - 1 ? C.accent : C.textMid,
                    cursor: "pointer", padding: "2px 6px", borderRadius: 3,
                    fontSize: 11, fontFamily: FONTS.mono,
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.surface; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  {bc.name || sep}
                </button>
              </span>
            )) : (
              <span style={{ color: C.textFaint }}>// loading…</span>
            )}
          </div>
        </div>

        {/* ── Body: side quick links + folder list ── */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
          {/* Quick links sidebar */}
          <div style={{
            width: 200, flexShrink: 0,
            background: C.surfaceAlt,
            borderRight: `1px solid ${C.border}`,
            overflowY: "auto",
            padding: "12px 0",
          }}>
            <div style={{
              padding: "0 18px 8px",
              fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
              letterSpacing: "0.18em", textTransform: "uppercase",
              color: C.textDim,
            }}>
              // Locations
            </div>
            {home?.entries.map((entry) => {
              const isCurrent = listing?.path === entry.path;
              const Icon = entry.name === "Home"
                ? Home
                : entry.name.toLowerCase().includes("drive")
                  ? HardDrive
                  : Folder;
              return (
                <button
                  key={entry.path}
                  onClick={() => loadPath(entry.path)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    width: "100%", padding: "8px 18px",
                    fontFamily: FONTS.mono, fontSize: 10,
                    textAlign: "left",
                    background: isCurrent ? C.accentDim : "transparent",
                    color: isCurrent ? C.accent : C.textMid,
                    border: "none", cursor: "pointer",
                    borderLeft: `2px solid ${isCurrent ? C.accent : "transparent"}`,
                  }}
                  onMouseEnter={(e) => {
                    if (!isCurrent) { e.currentTarget.style.background = C.surface; e.currentTarget.style.color = C.text; }
                  }}
                  onMouseLeave={(e) => {
                    if (!isCurrent) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textMid; }
                  }}
                >
                  <Icon size={12} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.name}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Folder list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
            {loading && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60 }}>
                <Loader2 size={18} className="animate-spin" style={{ color: C.accent }} />
              </div>
            )}

            {!loading && error && (
              <div style={{
                margin: 16, padding: 14,
                fontSize: 11, fontFamily: FONTS.mono,
                color: "#ff9b9b",
                background: "#ff6b6b12",
                border: "1px solid #ff6b6b33",
                borderRadius: 4,
              }}>
                {error}
              </div>
            )}

            {!loading && !error && listing && listing.folders.length === 0 && (
              <div style={{
                padding: "60px 24px", textAlign: "center",
                color: C.textDim, fontSize: 12, fontFamily: FONTS.sans,
                lineHeight: 1.7,
              }}>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: C.textFaint, letterSpacing: "0.18em", marginBottom: 8 }}>
                  // EMPTY
                </div>
                No subfolders here.<br />
                Click <span style={{ color: C.accent }}>Open this folder</span> below to use the current directory.
              </div>
            )}

            {!loading && !error && listing && listing.folders.map((entry) => (
              <button
                key={entry.path}
                onDoubleClick={() => loadPath(entry.path)}
                onClick={() => loadPath(entry.path)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  width: "100%", padding: "8px 22px",
                  fontFamily: FONTS.mono, fontSize: 11,
                  textAlign: "left",
                  background: "transparent", color: C.text,
                  border: "none", cursor: "pointer",
                  borderLeft: "2px solid transparent",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = C.surfaceAlt;
                  e.currentTarget.style.borderLeft = `2px solid ${C.accentLine}`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderLeft = "2px solid transparent";
                }}
              >
                <Folder size={13} style={{ color: C.textDim, flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {entry.name}
                </span>
                {entry.hasPackageJson && (
                  <span title="Contains package.json" style={{
                    display: "flex", alignItems: "center", gap: 4,
                    fontSize: 8, fontFamily: FONTS.mono,
                    letterSpacing: "0.12em", textTransform: "uppercase",
                    color: C.accent,
                    padding: "2px 7px", borderRadius: 3,
                    background: C.accentDim,
                    border: `1px solid ${C.accentLine}`,
                  }}>
                    <Package size={9} />
                    project
                  </span>
                )}
                <ChevronRight size={11} style={{ color: C.textFaint, flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </div>

        {/* ── Footer: current path + Open button ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px 22px",
          borderTop: `1px solid ${C.border}`,
          background: C.surfaceAlt,
        }}>
          <div style={{
            flex: 1, fontFamily: FONTS.mono, fontSize: 10,
            color: C.textMid,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            <span style={{ color: C.textFaint }}>$ cd </span>
            <span style={{ color: C.accent }}>{listing?.path || "—"}</span>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "8px 18px",
              fontFamily: FONTS.mono, fontSize: 10, fontWeight: 500,
              letterSpacing: "0.12em", textTransform: "uppercase",
              background: "transparent",
              color: C.textMid,
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handlePick}
            disabled={!listing || picking}
            style={{
              padding: "8px 22px",
              fontFamily: FONTS.mono, fontSize: 10, fontWeight: 600,
              letterSpacing: "0.12em", textTransform: "uppercase",
              background: !listing || picking ? C.surfaceAlt : C.accent,
              color: !listing || picking ? C.textDim : C.bg,
              border: `1px solid ${!listing || picking ? C.border : C.accent}`,
              borderRadius: 4,
              cursor: !listing || picking ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            {picking ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            Open this folder
          </button>
        </div>
      </div>
    </div>
  );
}
