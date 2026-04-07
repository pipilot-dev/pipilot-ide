import { useState, useEffect } from "react";
import { Package, Search, Download, Trash2, ToggleLeft, ToggleRight, Code2, RefreshCw } from "lucide-react";
import { useExtensions } from "@/hooks/useExtensions";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { BUILTIN_EXTENSIONS } from "@/lib/extensions/builtin";
import { ExtensionCard } from "./ExtensionCard";
import type { DBExtension } from "@/lib/extensions/types";

export function ExtensionMarketplace() {
  const { host } = useExtensions();
  const [tab, setTab] = useState<"installed" | "browse" | "develop">("installed");
  const [searchQuery, setSearchQuery] = useState("");

  // Live query for installed extensions
  const installed = useLiveQuery(() => db.extensions.toArray(), []) ?? [];

  // Auto-install built-in extensions on first load
  useEffect(() => {
    if (!host) return;
    BUILTIN_EXTENSIONS.forEach(async (bundle) => {
      const exists = await db.extensions.get(bundle.manifest.id);
      if (!exists) {
        await host.installExtension(bundle, "builtin");
      }
    });
  }, [host]);

  const filtered = installed.filter((ext) => {
    if (!searchQuery) return true;
    const manifest = JSON.parse(ext.manifest);
    const q = searchQuery.toLowerCase();
    return manifest.name.toLowerCase().includes(q) || manifest.description.toLowerCase().includes(q);
  });

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 12px", border: "none", cursor: "pointer",
    fontSize: 11, fontWeight: 500,
    color: active ? "hsl(207 90% 60%)" : "hsl(220 14% 55%)",
    background: "transparent",
    borderBottom: active ? "2px solid hsl(207 90% 60%)" : "2px solid transparent",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", color: "hsl(220 14% 75%)" }}>
      {/* Header */}
      <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid hsl(220 13% 25%)" }}>
        <Package size={14} style={{ color: "hsl(207 90% 60%)" }} />
        <span style={{ fontWeight: 600, fontSize: 12 }}>Extensions</span>
      </div>

      {/* Search */}
      <div style={{ padding: "8px 12px" }}>
        <div style={{ position: "relative" }}>
          <Search size={12} style={{ position: "absolute", left: 8, top: 7, color: "hsl(220 14% 45%)" }} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search extensions..."
            style={{
              width: "100%", padding: "5px 8px 5px 26px",
              background: "hsl(220 13% 20%)", border: "1px solid hsl(220 13% 28%)",
              borderRadius: 4, color: "hsl(220 14% 85%)", fontSize: 11,
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid hsl(220 13% 25%)", padding: "0 8px" }}>
        <button style={tabStyle(tab === "installed")} onClick={() => setTab("installed")}>Installed ({installed.length})</button>
        <button style={tabStyle(tab === "browse")} onClick={() => setTab("browse")}>Browse</button>
        <button style={tabStyle(tab === "develop")} onClick={() => setTab("develop")}>Develop</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {tab === "installed" && (
          filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: 20, color: "hsl(220 14% 45%)", fontSize: 11 }}>
              {searchQuery ? "No matching extensions" : "No extensions installed"}
            </div>
          ) : (
            filtered.map((ext) => (
              <ExtensionCard key={ext.id} extension={ext} host={host} mode="installed" />
            ))
          )
        )}

        {tab === "browse" && (
          <div>
            <div style={{ fontSize: 11, color: "hsl(220 14% 50%)", marginBottom: 8, padding: "0 4px" }}>
              Built-in extensions available for installation
            </div>
            {BUILTIN_EXTENSIONS.map((bundle) => {
              const isInstalled = installed.some((e) => e.id === bundle.manifest.id);
              return (
                <div key={bundle.manifest.id} style={{
                  padding: "8px 10px", margin: "4px 0", borderRadius: 6,
                  background: "hsl(220 13% 20%)", border: "1px solid hsl(220 13% 25%)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 6,
                      background: "hsl(207 90% 54% / 0.15)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Package size={14} style={{ color: "hsl(207 90% 60%)" }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "hsl(220 14% 85%)" }}>{bundle.manifest.name}</div>
                      <div style={{ fontSize: 10, color: "hsl(220 14% 50%)" }}>{bundle.manifest.author}</div>
                    </div>
                    {isInstalled ? (
                      <span style={{ fontSize: 10, color: "hsl(142 71% 45%)", fontWeight: 500 }}>Installed</span>
                    ) : (
                      <button
                        onClick={() => host?.installExtension(bundle, "builtin")}
                        style={{
                          padding: "3px 10px", fontSize: 10, fontWeight: 600,
                          background: "hsl(207 90% 54%)", color: "#fff",
                          border: "none", borderRadius: 4, cursor: "pointer",
                        }}
                      >
                        Install
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "hsl(220 14% 60%)", lineHeight: 1.4 }}>
                    {bundle.manifest.description}
                  </div>
                  {bundle.manifest.categories && (
                    <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                      {bundle.manifest.categories.map((c) => (
                        <span key={c} style={{
                          padding: "1px 6px", fontSize: 9, borderRadius: 3,
                          background: "hsl(220 13% 25%)", color: "hsl(220 14% 55%)",
                        }}>{c}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === "develop" && (
          <div style={{ padding: 8, fontSize: 12, color: "hsl(220 14% 65%)", lineHeight: 1.8 }}>
            <div style={{ fontWeight: 600, color: "hsl(207 90% 60%)", marginBottom: 8 }}>Create Your Own Extension</div>
            <p style={{ margin: "0 0 8px" }}>PiPilot extensions are JavaScript modules that receive a <code style={{ background: "hsl(220 13% 25%)", padding: "1px 4px", borderRadius: 3 }}>pipilot</code> API object.</p>

            <div style={{ background: "hsl(220 13% 14%)", padding: 12, borderRadius: 6, fontSize: 11, fontFamily: "monospace", lineHeight: 1.6, marginBottom: 12, overflowX: "auto" }}>
              {'function activate(pipilot) {'}<br/>
              {'  pipilot.commands.register('}<br/>
              {'    "myext.hello",'}<br/>
              {'    () => pipilot.ui.showNotification({'}<br/>
              {'      title: "Hello!",'}<br/>
              {'      message: "From my extension"'}<br/>
              {'    })'}<br/>
              {'  );'}<br/>
              {'}'}<br/>
              {'module.exports = { activate };'}
            </div>

            <div style={{ fontWeight: 600, marginBottom: 4 }}>Extension API:</div>
            <ul style={{ paddingLeft: 16, margin: "0 0 8px", fontSize: 11, color: "hsl(220 14% 55%)" }}>
              <li><code>pipilot.workspace.files</code> — read, list, create, edit, delete files</li>
              <li><code>pipilot.editor</code> — get active file, listen for changes</li>
              <li><code>pipilot.ui</code> — status bar, activity bar, sidebar panels, notifications</li>
              <li><code>pipilot.commands</code> — register & execute commands</li>
              <li><code>pipilot.chat</code> — add slash commands to AI chat</li>
              <li><code>pipilot.terminal</code> — add terminal commands</li>
              <li><code>pipilot.state</code> — persistent key-value storage</li>
            </ul>

            <div style={{ fontWeight: 600, marginBottom: 4 }}>Contribution Points:</div>
            <ul style={{ paddingLeft: 16, margin: 0, fontSize: 11, color: "hsl(220 14% 55%)" }}>
              <li>Activity Bar icons & sidebar panels</li>
              <li>Status bar items</li>
              <li>Command palette commands</li>
              <li>Chat slash commands</li>
              <li>File context menu items</li>
              <li>Terminal commands</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
