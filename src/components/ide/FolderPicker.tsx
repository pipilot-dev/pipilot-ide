import { useState, useEffect, useCallback } from "react";
import {
  Folder, FolderOpen, ChevronLeft, Home, HardDrive, Loader2, X,
  Check, Package, ChevronRight,
} from "lucide-react";

interface FolderPickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (absolutePath: string) => void | Promise<void>;
}

interface FsEntry {
  name: string;
  path: string;
  hasPackageJson?: boolean;
}

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

const COLORS = {
  bg: "hsl(220 13% 16%)",
  panelBg: "hsl(220 13% 12%)",
  text: "hsl(220 14% 90%)",
  textMuted: "hsl(220 14% 60%)",
  textDim: "hsl(220 14% 40%)",
  accent: "hsl(207 90% 60%)",
  accentBg: "hsl(207 90% 50% / 0.15)",
  border: "hsl(220 13% 26%)",
  hoverBg: "hsl(220 13% 22%)",
};

export function FolderPicker({ open, onClose, onPick }: FolderPickerProps) {
  const [home, setHome] = useState<HomeInfo | null>(null);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  // Fetch home / drives on mount
  useEffect(() => {
    if (!open) return;
    setError(null);
    setListing(null);
    fetch("/api/fs/home")
      .then((r) => r.json())
      .then((data: HomeInfo) => {
        setHome(data);
        // Auto-load home as the initial listing
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

  // Format the current path nicely with breadcrumbs
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
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: 720, height: 540, padding: 0,
        borderRadius: 10, overflow: "hidden",
        background: COLORS.bg,
        border: `1px solid ${COLORS.border}`,
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px",
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FolderOpen size={18} style={{ color: COLORS.accent }} />
            <h3 style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, margin: 0 }}>
              Open Folder
            </h3>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer", padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Breadcrumb / location bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "8px 14px",
          background: COLORS.panelBg,
          borderBottom: `1px solid ${COLORS.border}`,
          minHeight: 36,
        }}>
          <button
            disabled={!listing?.parent}
            onClick={() => listing?.parent && loadPath(listing.parent)}
            style={{
              background: "none", border: "none",
              color: listing?.parent ? COLORS.text : COLORS.textDim,
              cursor: listing?.parent ? "pointer" : "not-allowed",
              padding: 4, display: "flex", alignItems: "center",
            }}
            title="Go up"
          >
            <ChevronLeft size={14} />
          </button>
          <div style={{
            flex: 1, display: "flex", alignItems: "center", gap: 2,
            fontSize: 11, fontFamily: "monospace",
            color: COLORS.text,
            overflow: "hidden",
          }}>
            {breadcrumbs.length > 0 ? (
              breadcrumbs.map((bc, i) => (
                <span key={bc.path} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  {i > 0 && <ChevronRight size={9} style={{ color: COLORS.textDim, flexShrink: 0 }} />}
                  <button
                    onClick={() => loadPath(bc.path)}
                    style={{
                      background: "none", border: "none",
                      color: i === breadcrumbs.length - 1 ? COLORS.accent : COLORS.text,
                      cursor: "pointer", padding: "2px 4px", borderRadius: 3,
                      fontSize: 11, fontFamily: "monospace",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.hoverBg; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  >
                    {bc.name || sep}
                  </button>
                </span>
              ))
            ) : (
              <span style={{ color: COLORS.textDim }}>Loading...</span>
            )}
          </div>
        </div>

        {/* Body — sidebar with quick links + main folder list */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Sidebar quick links */}
          <div style={{
            width: 180, flexShrink: 0,
            background: COLORS.panelBg,
            borderRight: `1px solid ${COLORS.border}`,
            overflowY: "auto", padding: "8px 0",
          }}>
            {home?.entries.map((entry) => {
              const isCurrent = listing?.path === entry.path;
              const Icon = entry.name === "Home"
                ? Home
                : entry.name.endsWith("drive")
                  ? HardDrive
                  : Folder;
              return (
                <button
                  key={entry.path}
                  onClick={() => loadPath(entry.path)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    width: "100%", padding: "8px 14px",
                    fontSize: 11, textAlign: "left",
                    background: isCurrent ? COLORS.accentBg : "transparent",
                    color: isCurrent ? COLORS.accent : COLORS.text,
                    border: "none", cursor: "pointer",
                    borderLeft: `2px solid ${isCurrent ? COLORS.accent : "transparent"}`,
                  }}
                  onMouseEnter={(e) => {
                    if (!isCurrent) e.currentTarget.style.background = COLORS.hoverBg;
                  }}
                  onMouseLeave={(e) => {
                    if (!isCurrent) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <Icon size={13} style={{ color: isCurrent ? COLORS.accent : COLORS.textMuted, flexShrink: 0 }} />
                  <span style={{ fontWeight: isCurrent ? 600 : 400 }}>{entry.name}</span>
                </button>
              );
            })}
          </div>

          {/* Folder list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
            {loading && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
                <Loader2 size={18} className="animate-spin" style={{ color: COLORS.accent }} />
              </div>
            )}

            {!loading && error && (
              <div style={{
                margin: 16, padding: 12,
                fontSize: 11, color: "hsl(0 84% 70%)",
                background: "hsl(0 84% 50% / 0.1)",
                border: "1px solid hsl(0 84% 50% / 0.25)",
                borderRadius: 4,
              }}>
                {error}
              </div>
            )}

            {!loading && !error && listing && listing.folders.length === 0 && (
              <div style={{ padding: 24, textAlign: "center", color: COLORS.textDim, fontSize: 11 }}>
                No folders here. Click "Open this folder" below to use the current directory.
              </div>
            )}

            {!loading && !error && listing && listing.folders.map((entry) => (
              <button
                key={entry.path}
                onDoubleClick={() => loadPath(entry.path)}
                onClick={() => loadPath(entry.path)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  width: "100%", padding: "6px 16px",
                  fontSize: 12, textAlign: "left",
                  background: "transparent", color: COLORS.text,
                  border: "none", cursor: "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = COLORS.hoverBg; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <Folder size={14} style={{ color: "hsl(38 92% 60%)", flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{entry.name}</span>
                {entry.hasPackageJson && (
                  <span title="Contains package.json" style={{
                    display: "flex", alignItems: "center", gap: 3,
                    fontSize: 9, color: COLORS.accent,
                    padding: "1px 5px", borderRadius: 3,
                    background: COLORS.accentBg,
                  }}>
                    <Package size={9} />
                    project
                  </span>
                )}
                <ChevronRight size={11} style={{ color: COLORS.textDim, flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </div>

        {/* Footer with current path + Open button */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 16px",
          borderTop: `1px solid ${COLORS.border}`,
          background: COLORS.panelBg,
        }}>
          <div style={{ flex: 1, fontSize: 11, color: COLORS.textMuted, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {listing?.path || "—"}
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "6px 14px", fontSize: 12,
              background: "transparent", color: COLORS.textMuted,
              border: `1px solid ${COLORS.border}`, borderRadius: 5,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handlePick}
            disabled={!listing || picking}
            style={{
              padding: "6px 18px", fontSize: 12, fontWeight: 600,
              background: !listing || picking
                ? "hsl(220 13% 22%)"
                : "linear-gradient(135deg, hsl(207 90% 45%), hsl(207 90% 38%))",
              color: !listing || picking ? COLORS.textDim : "#fff",
              border: "none", borderRadius: 5,
              cursor: !listing || picking ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {picking ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Open this folder
          </button>
        </div>
      </div>
    </div>
  );
}
