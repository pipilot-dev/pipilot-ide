import { useState } from "react";
import { Package, Trash2, Power, PowerOff } from "lucide-react";
import type { ExtensionHost } from "@/lib/extensions/ExtensionHost";
import type { DBExtension, ExtensionManifest } from "@/lib/extensions/types";

interface ExtensionCardProps {
  extension: DBExtension;
  host: ExtensionHost | null;
  mode: "installed" | "browse";
}

export function ExtensionCard({ extension, host }: ExtensionCardProps) {
  const [loading, setLoading] = useState(false);
  const manifest: ExtensionManifest = JSON.parse(extension.manifest);

  const handleToggle = async () => {
    if (!host || loading) return;
    setLoading(true);
    try {
      if (extension.enabled) {
        await host.disableExtension(extension.id);
      } else {
        await host.enableExtension(extension.id);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUninstall = async () => {
    if (!host || loading) return;
    setLoading(true);
    try {
      await host.uninstallExtension(extension.id);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      padding: "8px 10px", margin: "4px 0", borderRadius: 6,
      background: "hsl(220 13% 20%)", border: "1px solid hsl(220 13% 25%)",
      opacity: extension.enabled ? 1 : 0.6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: extension.enabled ? "hsl(207 90% 54% / 0.15)" : "hsl(220 13% 25%)",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>
          <Package size={14} style={{ color: extension.enabled ? "hsl(207 90% 60%)" : "hsl(220 14% 45%)" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "hsl(220 14% 85%)" }}>{manifest.name}</div>
          <div style={{ fontSize: 10, color: "hsl(220 14% 50%)" }}>v{manifest.version} • {manifest.author}</div>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button
            onClick={handleToggle}
            disabled={loading}
            title={extension.enabled ? "Disable" : "Enable"}
            style={{
              width: 24, height: 24, border: "none", borderRadius: 4, cursor: "pointer",
              background: "transparent", color: extension.enabled ? "hsl(142 71% 45%)" : "hsl(220 14% 45%)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {extension.enabled ? <Power size={13} /> : <PowerOff size={13} />}
          </button>
          {extension.source !== "builtin" && (
            <button
              onClick={handleUninstall}
              disabled={loading}
              title="Uninstall"
              style={{
                width: 24, height: 24, border: "none", borderRadius: 4, cursor: "pointer",
                background: "transparent", color: "hsl(0 84% 60%)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "hsl(220 14% 60%)", marginTop: 4, lineHeight: 1.4 }}>
        {manifest.description}
      </div>
      {manifest.categories && manifest.categories.length > 0 && (
        <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
          {manifest.categories.map((c) => (
            <span key={c} style={{
              padding: "1px 6px", fontSize: 9, borderRadius: 3,
              background: "hsl(220 13% 25%)", color: "hsl(220 14% 55%)",
            }}>{c}</span>
          ))}
          <span style={{
            padding: "1px 6px", fontSize: 9, borderRadius: 3,
            background: extension.source === "builtin" ? "hsl(207 90% 54% / 0.2)" : "hsl(142 71% 45% / 0.2)",
            color: extension.source === "builtin" ? "hsl(207 90% 60%)" : "hsl(142 71% 45%)",
          }}>{extension.source}</span>
        </div>
      )}
    </div>
  );
}
