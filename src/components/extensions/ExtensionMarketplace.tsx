import { useState, useEffect, useCallback } from "react";
import {
  Package, Search, Download, Trash2, Plus, RefreshCw, Plug, Globe,
  Terminal, Key, CheckCircle2, XCircle, ChevronRight, Settings, Loader2,
  Palette, Keyboard,
} from "lucide-react";
import { useExtensions } from "@/hooks/useExtensions";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { BUILTIN_EXTENSIONS } from "@/lib/extensions/builtin";
import { ExtensionCard } from "./ExtensionCard";
import { useActiveProject } from "@/contexts/ProjectContext";
import { COLORS as C, FONTS } from "@/lib/design-tokens";

interface McpServerInfo {
  name: string;
  title: string;
  description: string;
  version: string;
  websiteUrl: string;
  repository: string;
  remotes: { type: string; url: string }[];
  packages: { registry: string; identifier: string; version: string; transport: string; envVars: { name: string; description: string; required: boolean; secret: boolean }[] }[];
  icons: string[];
}

interface DefaultMcp {
  name: string;
  description: string;
  type: string;
  url?: string;
  urlTemplate?: string;
  command?: string;
  args?: string[];
  builtin?: boolean;
  envVars?: { name: string; description: string; required: boolean; secret?: boolean }[];
}

export function ExtensionMarketplace() {
  const { host } = useExtensions();
  const { activeProjectId } = useActiveProject();
  const [tab, setTab] = useState<"mcp" | "connectors" | "agents" | "themes" | "registry">("mcp");
  const [searchQuery, setSearchQuery] = useState("");
  const [installScope, setInstallScope] = useState<"project" | "global">("project");

  // Extension state
  const installed = useLiveQuery(() => db.extensions.toArray(), []) ?? [];
  useEffect(() => {
    if (!host) return;
    BUILTIN_EXTENSIONS.forEach(async (bundle) => {
      const exists = await db.extensions.get(bundle.manifest.id);
      if (!exists) await host.installExtension(bundle, "builtin");
    });
  }, [host]);

  // MCP state
  const [defaults, setDefaults] = useState<{ defaults: DefaultMcp[]; configurable: DefaultMcp[] }>({ defaults: [], configurable: [] });
  const [userMcp, setUserMcp] = useState<Record<string, any>>({});
  const [registryResults, setRegistryResults] = useState<McpServerInfo[]>([]);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState<string | null>(null);

  // Load defaults + user config
  useEffect(() => {
    fetch("/api/mcp/defaults").then((r) => r.json()).then(setDefaults).catch(() => {});
  }, []);

  const refreshUserMcp = useCallback(() => {
    if (!activeProjectId) return;
    fetch(`/api/mcp/config?projectId=${encodeURIComponent(activeProjectId)}`)
      .then((r) => r.json())
      .then((d) => setUserMcp(d.mcpServers || {}))
      .catch(() => {});
  }, [activeProjectId]);

  useEffect(() => { refreshUserMcp(); }, [refreshUserMcp]);

  // Registry search
  const searchRegistry = useCallback(async (q: string) => {
    setRegistryLoading(true);
    try {
      const res = await fetch(`/api/mcp/search?search=${encodeURIComponent(q)}&limit=30`);
      const data = await res.json();
      setRegistryResults(data.servers || []);
    } catch {} finally {
      setRegistryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "registry") searchRegistry(searchQuery);
  }, [tab]);

  // Listen for external tab switch (e.g. Deploy panel → "open connectors tab")
  useEffect(() => {
    const handler = (e: Event) => {
      const t = (e as CustomEvent).detail?.tab;
      if (t && ["mcp", "connectors", "agents", "themes", "registry"].includes(t)) {
        setTab(t);
      }
    };
    window.addEventListener("pipilot:extensions-set-tab", handler);
    return () => window.removeEventListener("pipilot:extensions-set-tab", handler);
  }, []);

  // Install MCP server
  const installMcp = useCallback(async (name: string, config: any) => {
    if (!activeProjectId) return;
    setInstalling(name);
    try {
      const res = await fetch("/api/mcp/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, name, config, scope: installScope }),
      });
      const data = await res.json();
      if (data.success) {
        window.dispatchEvent(new CustomEvent("pipilot:notify", {
          detail: { type: "success", title: "MCP Server Installed", message: `${name} is now available to the AI agent` },
        }));
      } else {
        window.dispatchEvent(new CustomEvent("pipilot:notify", {
          detail: { type: "error", title: "Install Failed", message: data.error || "Unknown error" },
        }));
      }
      await refreshUserMcp();
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent("pipilot:notify", {
        detail: { type: "error", title: "Install Failed", message: err.message },
      }));
    } finally {
      setInstalling(null);
    }
  }, [activeProjectId, refreshUserMcp]);

  // Uninstall MCP server
  const uninstallMcp = useCallback(async (name: string) => {
    if (!activeProjectId) return;
    try {
      await fetch("/api/mcp/uninstall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, name }),
      });
      window.dispatchEvent(new CustomEvent("pipilot:notify", {
        detail: { type: "info", title: "MCP Server Removed", message: name },
      }));
      await refreshUserMcp();
    } catch {}
  }, [activeProjectId, refreshUserMcp]);

  // ── Connectors state ──
  const [cliConnectors, setCliConnectors] = useState<{ id: string; name: string; description: string; tokenLabel: string; tokenUrl: string; envVar: string }[]>([]);
  const [connectorStatus, setConnectorStatus] = useState<Record<string, { enabled: boolean; hasToken: boolean }>>({});
  const [connectorTokenInputs, setConnectorTokenInputs] = useState<Record<string, string>>({});
  const [connectorExpanded, setConnectorExpanded] = useState<string | null>(null);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customForm, setCustomForm] = useState({ id: "", envVar: "", token: "", description: "" });

  useEffect(() => {
    fetch("/api/connectors/list").then((r) => r.json()).then((d) => setCliConnectors(d.connectors || [])).catch(() => {});
  }, []);

  const refreshConnectors = useCallback(() => {
    if (!activeProjectId) return;
    fetch(`/api/connectors/config?projectId=${encodeURIComponent(activeProjectId)}`)
      .then((r) => r.json())
      .then((d) => setConnectorStatus(d.connectors || {}))
      .catch(() => {});
  }, [activeProjectId]);

  useEffect(() => { refreshConnectors(); }, [refreshConnectors]);

  const saveConnector = useCallback(async (connectorId: string, token: string) => {
    if (!activeProjectId) return;
    try {
      const res = await fetch("/api/connectors/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, connectorId, token, enabled: true, scope: installScope }),
      });
      const data = await res.json();
      if (data.success) {
        window.dispatchEvent(new CustomEvent("pipilot:notify", {
          detail: { type: "success", title: "Connector Configured", message: `${connectorId} — token saved. Agent can now use the CLI.` },
        }));
        setConnectorTokenInputs((p) => ({ ...p, [connectorId]: "" }));
        setConnectorExpanded(null);
        await refreshConnectors();
      }
    } catch {}
  }, [activeProjectId, refreshConnectors]);

  const removeConnector = useCallback(async (connectorId: string) => {
    if (!activeProjectId) return;
    try {
      await fetch("/api/connectors/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, connectorId }),
      });
      window.dispatchEvent(new CustomEvent("pipilot:notify", {
        detail: { type: "info", title: "Connector Removed", message: connectorId },
      }));
      await refreshConnectors();
    } catch {}
  }, [activeProjectId, refreshConnectors]);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 10px", border: "none", cursor: "pointer",
    fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
    color: active ? C.accent : "hsl(220 14% 50%)",
    background: "transparent",
    borderBottom: active ? `2px solid ${C.accent}` : "2px solid transparent",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", color: "hsl(220 14% 75%)", fontFamily: FONTS.sans }}>
      {/* Header */}
      <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid hsl(220 13% 22%)" }}>
        <Plug size={13} style={{ color: C.accent }} />
        <span style={{ fontWeight: 600, fontSize: 11, fontFamily: FONTS.mono, letterSpacing: "0.04em", textTransform: "uppercase" }}>Extensions Hub</span>
      </div>

      {/* Search */}
      <div style={{ padding: "8px 10px" }}>
        <div style={{ position: "relative" }}>
          <Search size={11} style={{ position: "absolute", left: 8, top: 7, color: "hsl(220 14% 40%)" }} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && tab === "registry") searchRegistry(searchQuery); }}
            placeholder={tab === "registry" ? "Search MCP registry..." : "Filter..."}
            style={{
              width: "100%", padding: "5px 8px 5px 26px",
              background: "hsl(220 13% 18%)", border: "1px solid hsl(220 13% 26%)",
              borderRadius: 4, color: "hsl(220 14% 85%)", fontSize: 11,
              fontFamily: FONTS.mono, outline: "none",
            }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid hsl(220 13% 22%)", padding: "0 6px", overflowX: "auto" }}>
        <button style={tabStyle(tab === "mcp")} onClick={() => setTab("mcp")}>
          MCP
        </button>
        <button style={tabStyle(tab === "connectors")} onClick={() => setTab("connectors")}>
          Connectors
        </button>
        <button style={tabStyle(tab === "agents")} onClick={() => setTab("agents")}>
          Agents
        </button>
        <button style={tabStyle(tab === "themes")} onClick={() => setTab("themes")}>
          Themes
        </button>
        <button style={tabStyle(tab === "registry")} onClick={() => setTab("registry")}>
          Registry
        </button>
      </div>

      {/* Scope toggle — compact inline bar */}
      {(tab === "mcp" || tab === "connectors" || tab === "registry") && (
        <div style={{
          display: "flex", alignItems: "center", gap: 4, padding: "3px 10px",
          borderBottom: "1px solid hsl(220 13% 22%)",
        }}>
          {(["project", "global"] as const).map((s) => (
            <button key={s} onClick={() => setInstallScope(s)} style={{
              padding: "1px 6px", fontSize: 8, fontFamily: FONTS.mono, fontWeight: 600,
              borderRadius: 2, border: "none", cursor: "pointer",
              letterSpacing: "0.04em", textTransform: "uppercase",
              background: installScope === s ? (s === "global" ? "#6cb6ff18" : "#FF6B3518") : "transparent",
              color: installScope === s ? (s === "global" ? "#6cb6ff" : "#FF6B35") : "hsl(220 10% 48%)",
            }}>{s === "project" ? "Project" : "Global"}</button>
          ))}
          <span style={{ fontSize: 8, color: "hsl(220 10% 40%)", fontFamily: FONTS.mono }}>
            {installScope === "global" ? "all projects" : "this project"}
          </span>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>

        {/* ── MCP Servers tab ── */}
        {tab === "mcp" && (
          <div>
            {/* Active (user-installed) MCP servers */}
            {Object.keys(userMcp).length > 0 && (
              <>
                <SectionLabel>Installed</SectionLabel>
                {Object.entries(userMcp).map(([name, config]) => (
                  <McpCard key={name} name={name} config={config} installed
                    onUninstall={() => uninstallMcp(name)}
                  />
                ))}
              </>
            )}

            {/* Built-in (always active) */}
            <SectionLabel>Built-in</SectionLabel>
            {defaults.defaults?.map((d) => (
              <McpCard key={d.name} name={d.name} description={d.description} builtin />
            ))}

            {/* Configurable (need API keys) */}
            <SectionLabel>Available</SectionLabel>
            {defaults.configurable?.map((d) => {
              const isInstalled = d.name in userMcp;
              const isConfiguring = configuring === d.name;
              return (
                <div key={d.name} style={{
                  padding: "8px 10px", margin: "4px 0", borderRadius: 6,
                  background: "hsl(220 13% 17%)", border: "1px solid hsl(220 13% 24%)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: 6,
                      background: isInstalled ? "hsl(142 50% 20%)" : "hsl(220 13% 22%)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {isInstalled ? <CheckCircle2 size={12} color="#6ee7b7" /> : <Plug size={12} style={{ color: "hsl(220 14% 50%)" }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 14% 85%)" }}>{d.name}</div>
                      <div style={{ fontSize: 10, color: "hsl(220 14% 50%)" }}>{d.description}</div>
                    </div>
                    {isInstalled ? (
                      <button onClick={() => uninstallMcp(d.name)} style={{
                        padding: "3px 8px", fontSize: 9, background: "transparent",
                        color: "hsl(0 70% 60%)", border: "1px solid hsl(0 50% 35%)",
                        borderRadius: 3, cursor: "pointer", fontFamily: FONTS.mono,
                      }}>Remove</button>
                    ) : (
                      <button onClick={() => {
                        if (d.envVars?.length) {
                          setConfiguring(isConfiguring ? null : d.name);
                          setConfigValues({});
                        } else {
                          // No env vars needed — install directly
                          const config: any = d.type === "http" ? { type: "http", url: d.url || d.urlTemplate } : { command: d.command, args: d.args };
                          installMcp(d.name, config);
                        }
                      }} style={{
                        padding: "3px 8px", fontSize: 9, fontFamily: FONTS.mono,
                        background: C.accent, color: "hsl(220 13% 10%)", fontWeight: 600,
                        border: "none", borderRadius: 3, cursor: "pointer",
                      }}>
                        {d.envVars?.length ? "Configure" : "Install"}
                      </button>
                    )}
                  </div>

                  {/* Config form */}
                  {isConfiguring && d.envVars && (
                    <div style={{ marginTop: 8, padding: "8px 0 0", borderTop: "1px solid hsl(220 13% 22%)" }}>
                      {d.envVars.map((v) => (
                        <div key={v.name} style={{ marginBottom: 6 }}>
                          <label style={{ fontSize: 9, color: "hsl(220 14% 50%)", fontFamily: FONTS.mono, display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}>
                            <Key size={9} />
                            {v.name}
                            {v.required && <span style={{ color: C.accent }}>*</span>}
                          </label>
                          <input
                            type={v.secret ? "password" : "text"}
                            value={configValues[v.name] || ""}
                            onChange={(e) => setConfigValues((p) => ({ ...p, [v.name]: e.target.value }))}
                            placeholder={v.description}
                            style={{
                              width: "100%", padding: "4px 8px", fontSize: 10,
                              background: "hsl(220 13% 12%)", border: "1px solid hsl(220 13% 24%)",
                              borderRadius: 3, color: "hsl(220 14% 80%)", fontFamily: FONTS.mono,
                              outline: "none",
                            }}
                          />
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          let url = d.url || d.urlTemplate || "";
                          // Replace template vars
                          for (const [k, v] of Object.entries(configValues)) {
                            url = url.replace(`{${k}}`, v);
                          }
                          const config: any = d.type === "http"
                            ? { type: "http", url, headers: d.envVars?.some((v) => v.name.includes("TOKEN") || v.name.includes("KEY")) ? { Authorization: `Bearer ${configValues[d.envVars.find((v) => v.secret)?.name || ""] || ""}` } : undefined }
                            : { command: d.command, args: d.args, env: configValues };
                          installMcp(d.name, config);
                          setConfiguring(null);
                        }}
                        disabled={d.envVars.filter((v) => v.required).some((v) => !configValues[v.name])}
                        style={{
                          padding: "4px 12px", fontSize: 9, fontFamily: FONTS.mono, fontWeight: 600,
                          background: C.accent, color: "hsl(220 13% 10%)",
                          border: "none", borderRadius: 3, cursor: "pointer", marginTop: 4,
                        }}
                      >
                        Install
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Registry tab ── */}
        {tab === "registry" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <button
                onClick={() => searchRegistry(searchQuery)}
                disabled={registryLoading}
                style={{
                  padding: "4px 10px", fontSize: 9, fontFamily: FONTS.mono, fontWeight: 600,
                  background: C.accent, color: "hsl(220 13% 10%)",
                  border: "none", borderRadius: 3, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 4,
                }}
              >
                {registryLoading ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />}
                Search Registry
              </button>
              <span style={{ fontSize: 9, color: "hsl(220 14% 40%)" }}>
                {registryResults.length > 0 && `${registryResults.length} results`}
              </span>
            </div>

            {registryResults.filter((s) => s.isLatest !== false).map((server) => {
              const sanitizedName = server.name.replace(/[^a-z0-9]/gi, "-");
              const isInstalled = sanitizedName in userMcp || server.name in userMcp;
              const remote = server.remotes[0];
              const pkg = server.packages[0];
              const needsConfig = pkg?.envVars?.some((v: any) => v.required) || false;
              const isConfigOpen = configuring === sanitizedName;
              return (
                <div key={`${server.name}-${server.version}`} style={{
                  padding: "8px 10px", margin: "4px 0", borderRadius: 6,
                  background: "hsl(220 13% 17%)", border: "1px solid hsl(220 13% 24%)",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                      background: "hsl(220 13% 22%)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      overflow: "hidden",
                    }}>
                      {server.icons[0] ? (
                        <img src={server.icons[0]} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <Globe size={12} style={{ color: "hsl(220 14% 50%)" }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 14% 85%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {server.title || server.name}
                      </div>
                      <div style={{ fontSize: 9, color: "hsl(220 14% 45%)", fontFamily: FONTS.mono }}>{server.name} v{server.version}</div>
                      <div style={{ fontSize: 10, color: "hsl(220 14% 55%)", lineHeight: 1.3, marginTop: 2 }}>{server.description}</div>
                      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        {remote && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 2, background: "hsl(207 60% 25%)", color: "hsl(207 80% 70%)" }}>{remote.type}</span>}
                        {pkg && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 2, background: "hsl(142 40% 22%)", color: "hsl(142 60% 65%)" }}>{pkg.registry}</span>}
                        {needsConfig && <span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 2, background: "hsl(38 80% 22%)", color: "hsl(38 90% 65%)" }}>needs key</span>}
                      </div>
                    </div>
                    {isInstalled ? (
                      <span style={{ fontSize: 9, color: "#6ee7b7", fontWeight: 600, flexShrink: 0 }}>Installed</span>
                    ) : (
                      <button
                        onClick={() => {
                          if (needsConfig) {
                            setConfiguring(isConfigOpen ? null : sanitizedName);
                            setConfigValues({});
                            return;
                          }
                          if (remote) {
                            installMcp(sanitizedName, { type: remote.type === "sse" ? "sse" : "http", url: remote.url });
                          } else if (pkg) {
                            installMcp(sanitizedName, { command: "npx", args: ["-y", pkg.identifier] });
                          }
                        }}
                        disabled={installing === server.name}
                        style={{
                          padding: "3px 8px", fontSize: 9, fontFamily: FONTS.mono, fontWeight: 600,
                          background: C.accent, color: "hsl(220 13% 10%)",
                          border: "none", borderRadius: 3, cursor: "pointer", flexShrink: 0,
                        }}
                      >
                        {needsConfig ? "Configure" : "Install"}
                      </button>
                    )}
                  </div>

                  {/* Env var config form for registry servers that need API keys */}
                  {isConfigOpen && pkg?.envVars?.length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid hsl(220 13% 22%)" }}>
                      {pkg.envVars.map((v: any) => (
                        <div key={v.name} style={{ marginBottom: 5 }}>
                          <label style={{ fontSize: 9, color: "hsl(220 14% 50%)", fontFamily: FONTS.mono, display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                            <Key size={9} />
                            {v.name} {v.required && <span style={{ color: C.accent }}>*</span>}
                          </label>
                          <input
                            type={v.secret ? "password" : "text"}
                            value={configValues[v.name] || ""}
                            onChange={(e) => setConfigValues((p) => ({ ...p, [v.name]: e.target.value }))}
                            placeholder={v.description || v.name}
                            style={inputStyle}
                          />
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          const env: Record<string, string> = {};
                          for (const v of pkg.envVars) env[v.name] = configValues[v.name] || "";
                          if (pkg.transport === "stdio") {
                            installMcp(sanitizedName, { command: "npx", args: ["-y", pkg.identifier], env });
                          } else if (remote) {
                            installMcp(sanitizedName, { type: remote.type === "sse" ? "sse" : "http", url: remote.url, headers: env });
                          }
                          setConfiguring(null);
                          setConfigValues({});
                        }}
                        disabled={pkg.envVars.filter((v: any) => v.required).some((v: any) => !configValues[v.name])}
                        style={{
                          padding: "4px 12px", fontSize: 9, fontFamily: FONTS.mono, fontWeight: 600,
                          background: C.accent, color: "hsl(220 13% 10%)",
                          border: "none", borderRadius: 3, cursor: "pointer", marginTop: 4,
                        }}
                      >
                        Install
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {registryResults.length === 0 && !registryLoading && (
              <div style={{ textAlign: "center", padding: 20, color: "hsl(220 14% 40%)", fontSize: 11 }}>
                Search the official MCP server registry to find and install tools for your AI agent.
              </div>
            )}
          </div>
        )}

        {/* ── Connectors tab ── */}
        {tab === "connectors" && (
          <div>
            <div style={{ fontSize: 10, color: "hsl(220 14% 45%)", padding: "2px 4px 8px", lineHeight: 1.5 }}>
              CLI connectors inject API tokens into the agent's environment so CLI tools (vercel, netlify, etc.) work without manual login.
            </div>
            {cliConnectors.map((conn) => {
              const status = connectorStatus[conn.id];
              const isConfigured = status?.enabled && status?.hasToken;
              const isExpanded = connectorExpanded === conn.id;
              return (
                <div key={conn.id} style={{
                  padding: "8px 10px", margin: "4px 0", borderRadius: 6,
                  background: "hsl(220 13% 17%)", border: `1px solid ${isConfigured ? "hsl(142 40% 28%)" : "hsl(220 13% 24%)"}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                      background: isConfigured ? "hsl(142 40% 20%)" : "hsl(220 13% 22%)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {isConfigured
                        ? <CheckCircle2 size={12} color="#6ee7b7" />
                        : <Key size={12} style={{ color: "hsl(220 14% 50%)" }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 14% 85%)" }}>{conn.name}</div>
                      <div style={{ fontSize: 9, color: "hsl(220 14% 45%)" }}>{conn.description}</div>
                    </div>
                    {isConfigured ? (
                      <button onClick={() => removeConnector(conn.id)} style={{
                        padding: "3px 8px", fontSize: 9, fontFamily: FONTS.mono,
                        background: "transparent", color: "hsl(0 60% 55%)",
                        border: "1px solid hsl(0 40% 30%)", borderRadius: 3, cursor: "pointer",
                      }}>Remove</button>
                    ) : (
                      <button onClick={() => setConnectorExpanded(isExpanded ? null : conn.id)} style={{
                        padding: "3px 8px", fontSize: 9, fontFamily: FONTS.mono, fontWeight: 600,
                        background: C.accent, color: "hsl(220 13% 10%)",
                        border: "none", borderRadius: 3, cursor: "pointer",
                      }}>Configure</button>
                    )}
                  </div>

                  {isExpanded && !isConfigured && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid hsl(220 13% 22%)" }}>
                      <div style={{ fontSize: 9, color: "hsl(220 14% 45%)", marginBottom: 4 }}>
                        <Key size={9} style={{ display: "inline", verticalAlign: "middle" }} /> {conn.tokenLabel}
                        {" · "}
                        <a href={`https://${conn.tokenUrl}`} target="_blank" rel="noopener noreferrer"
                          style={{ color: C.accent, textDecoration: "none" }}
                        >
                          Get token →
                        </a>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input
                          type="password"
                          value={connectorTokenInputs[conn.id] || ""}
                          onChange={(e) => setConnectorTokenInputs((p) => ({ ...p, [conn.id]: e.target.value }))}
                          placeholder={`Paste your ${conn.name} token`}
                          style={{
                            flex: 1, padding: "5px 8px", fontSize: 10,
                            background: "hsl(220 13% 12%)", border: "1px solid hsl(220 13% 24%)",
                            borderRadius: 3, color: "hsl(220 14% 80%)", fontFamily: FONTS.mono,
                            outline: "none",
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && connectorTokenInputs[conn.id]?.trim()) {
                              saveConnector(conn.id, connectorTokenInputs[conn.id].trim());
                            }
                          }}
                        />
                        <button
                          onClick={() => saveConnector(conn.id, (connectorTokenInputs[conn.id] || "").trim())}
                          disabled={!connectorTokenInputs[conn.id]?.trim()}
                          style={{
                            padding: "5px 12px", fontSize: 9, fontFamily: FONTS.mono, fontWeight: 600,
                            background: connectorTokenInputs[conn.id]?.trim() ? C.accent : "hsl(220 13% 22%)",
                            color: connectorTokenInputs[conn.id]?.trim() ? "hsl(220 13% 10%)" : "hsl(220 14% 40%)",
                            border: "none", borderRadius: 3,
                            cursor: connectorTokenInputs[conn.id]?.trim() ? "pointer" : "default",
                          }}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Custom connectors (user-added) */}
            {Object.entries(connectorStatus).filter(([, s]) => (s as any).custom).length > 0 && (
              <>
                <SectionLabel>Custom</SectionLabel>
                {Object.entries(connectorStatus)
                  .filter(([, s]) => (s as any).custom)
                  .map(([id, s]) => (
                    <div key={id} style={{
                      padding: "7px 10px", margin: "3px 0", borderRadius: 5,
                      background: "hsl(220 13% 17%)", border: "1px solid hsl(142 40% 28%)",
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                      <CheckCircle2 size={12} color="#6ee7b7" style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 14% 82%)" }}>{(s as any).label || id}</div>
                        <div style={{ fontSize: 9, color: "hsl(220 14% 45%)" }}>
                          {(s as any).description || ""}{(s as any).envVar ? ` · ${(s as any).envVar}` : ""}
                        </div>
                      </div>
                      <button onClick={() => removeConnector(id)} style={{
                        background: "none", border: "none", color: "hsl(0 60% 55%)", cursor: "pointer", padding: 2,
                      }}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))}
              </>
            )}

            {/* Add Custom Connector */}
            <div style={{ marginTop: 10 }}>
              {!showAddCustom ? (
                <button onClick={() => setShowAddCustom(true)} style={{
                  display: "flex", alignItems: "center", gap: 6, width: "100%",
                  padding: "8px 10px", borderRadius: 5,
                  background: "transparent", border: `1px dashed hsl(220 13% 28%)`,
                  color: "hsl(220 14% 50%)", fontFamily: FONTS.mono, fontSize: 10,
                  cursor: "pointer",
                }}>
                  <Plus size={12} /> Add custom connector
                </button>
              ) : (
                <div style={{
                  padding: "10px", borderRadius: 6,
                  background: "hsl(220 13% 17%)", border: "1px solid hsl(220 13% 24%)",
                }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "hsl(220 14% 75%)", marginBottom: 8 }}>
                    New CLI Connector
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <input
                      placeholder="Name (e.g. fly, doppler, aws)"
                      value={customForm.id}
                      onChange={(e) => setCustomForm((p) => ({ ...p, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                      style={inputStyle}
                    />
                    <input
                      placeholder="Env var name (e.g. FLY_API_TOKEN)"
                      value={customForm.envVar}
                      onChange={(e) => setCustomForm((p) => ({ ...p, envVar: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") }))}
                      style={inputStyle}
                    />
                    <input
                      placeholder="Description (optional)"
                      value={customForm.description}
                      onChange={(e) => setCustomForm((p) => ({ ...p, description: e.target.value }))}
                      style={inputStyle}
                    />
                    <input
                      type="password"
                      placeholder="Token / API key"
                      value={customForm.token}
                      onChange={(e) => setCustomForm((p) => ({ ...p, token: e.target.value }))}
                      style={inputStyle}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                      <button
                        onClick={() => { setShowAddCustom(false); setCustomForm({ id: "", envVar: "", token: "", description: "" }); }}
                        style={{
                          padding: "4px 10px", fontSize: 9, fontFamily: FONTS.mono,
                          background: "transparent", color: "hsl(220 14% 55%)",
                          border: "1px solid hsl(220 13% 26%)", borderRadius: 3, cursor: "pointer",
                        }}
                      >Cancel</button>
                      <button
                        disabled={!customForm.id || !customForm.envVar || !customForm.token}
                        onClick={async () => {
                          await saveConnector(customForm.id, customForm.token);
                          // Save again with metadata
                          if (activeProjectId) {
                            await fetch("/api/connectors/save", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                projectId: activeProjectId,
                                connectorId: customForm.id,
                                token: customForm.token,
                                envVar: customForm.envVar,
                                label: customForm.id,
                                description: customForm.description,
                                enabled: true,
                              }),
                            });
                            refreshConnectors();
                          }
                          setShowAddCustom(false);
                          setCustomForm({ id: "", envVar: "", token: "", description: "" });
                        }}
                        style={{
                          padding: "4px 12px", fontSize: 9, fontFamily: FONTS.mono, fontWeight: 600,
                          background: (customForm.id && customForm.envVar && customForm.token) ? C.accent : "hsl(220 13% 22%)",
                          color: (customForm.id && customForm.envVar && customForm.token) ? "hsl(220 13% 10%)" : "hsl(220 14% 40%)",
                          border: "none", borderRadius: 3,
                          cursor: (customForm.id && customForm.envVar && customForm.token) ? "pointer" : "default",
                        }}
                      >Add Connector</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Agents tab ── */}
        {tab === "agents" && (
          <AgentsTab searchQuery={searchQuery} />
        )}

        {/* ── Themes tab ── */}
        {tab === "themes" && (
          <ThemesTab />
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "5px 8px", fontSize: 10,
  background: "hsl(220 13% 12%)", border: "1px solid hsl(220 13% 24%)",
  borderRadius: 3, color: "hsl(220 14% 80%)", fontFamily: FONTS.mono,
  outline: "none", width: "100%",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, color: "hsl(220 14% 45%)",
      fontFamily: FONTS.mono, letterSpacing: "0.08em", textTransform: "uppercase",
      padding: "8px 4px 4px", marginTop: 4,
    }}>
      {children}
    </div>
  );
}

function McpCard({ name, description, config, builtin, installed, onUninstall }: {
  name: string; description?: string; config?: any; builtin?: boolean; installed?: boolean;
  onUninstall?: () => void;
}) {
  const desc = description || config?.url || config?.command || "";
  return (
    <div style={{
      padding: "7px 10px", margin: "3px 0", borderRadius: 5,
      background: "hsl(220 13% 17%)", border: "1px solid hsl(220 13% 24%)",
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: 5, flexShrink: 0,
        background: builtin ? "hsl(142 40% 20%)" : "hsl(207 50% 22%)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {builtin ? <CheckCircle2 size={11} color="#6ee7b7" /> : <Plug size={11} style={{ color: "hsl(207 80% 65%)" }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 14% 82%)" }}>{name}</div>
        <div style={{ fontSize: 9, color: "hsl(220 14% 45%)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{desc}</div>
      </div>
      {builtin && <span style={{ fontSize: 8, color: "#6ee7b7", fontFamily: FONTS.mono }}>ACTIVE</span>}
      {installed && onUninstall && (
        <button onClick={onUninstall} title="Remove" style={{
          background: "none", border: "none", color: "hsl(0 60% 55%)", cursor: "pointer", padding: 2,
        }}>
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

// ── Agents Tab ──
function AgentsTab({ searchQuery }: { searchQuery: string }) {
  const [agents, setAgents] = useState<{ id: string; name: string; description: string; model: string; builtin: boolean }[]>([]);
  const [browseResults, setBrowseResults] = useState<{ name: string; description: string; category: string }[]>([]);
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    fetch("/api/agents/list").then((r) => r.json()).then((d) => setAgents(d.agents || [])).catch(() => {});
  }, []);

  const browseRepo = async () => {
    setBrowsing(true);
    try {
      const res = await fetch("https://api.github.com/repos/VoltAgent/awesome-claude-code-subagents/contents/categories");
      const categories = await res.json();
      const results: { name: string; description: string; category: string }[] = [];
      // Fetch first 4 categories for speed
      for (const cat of (categories as any[]).slice(0, 4)) {
        try {
          const catRes = await fetch(cat.url);
          const files = await catRes.json();
          for (const f of (files as any[]).filter((f: any) => f.name.endsWith(".md"))) {
            results.push({
              name: f.name.replace(".md", ""),
              description: cat.name.replace(/-/g, " "),
              category: cat.name,
            });
          }
        } catch {}
      }
      setBrowseResults(results);
    } catch {} finally {
      setBrowsing(false);
    }
  };

  const filtered = agents.filter((a) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.id.includes(q);
  });

  const agentColors: Record<string, string> = {
    "fullstack-developer": "#3b82f6",
    "ai-engineer": "#8b5cf6",
    "api-designer": "#06b6d4",
    "security-engineer": "#ef4444",
    "deployment-engineer": "#f59e0b",
    "frontend-designer": "#ec4899",
    "agent-installer": "#22c55e",
    "mcp-installer": "#14b8a6",
    "connector-finder": "#f97316",
  };

  return (
    <div>
      <SectionLabel>Installed Agents ({filtered.length})</SectionLabel>
      {filtered.map((agent) => {
        const color = agentColors[agent.id] || C.accent;
        return (
          <div key={agent.id} style={{
            padding: "8px 10px", margin: "3px 0", borderRadius: 6,
            background: "hsl(220 13% 17%)", border: "1px solid hsl(220 13% 24%)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6, flexShrink: 0,
              background: `${color}18`, border: `1px solid ${color}30`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color, fontSize: 11, fontWeight: 700, fontFamily: FONTS.mono,
            }}>
              {agent.name.charAt(0)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "hsl(220 14% 85%)" }}>{agent.name}</div>
              <div style={{ fontSize: 9, color: "hsl(220 14% 45%)" }}>{agent.description}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <span style={{ fontSize: 8, padding: "2px 5px", borderRadius: 2, background: `${color}15`, color, fontFamily: FONTS.mono }}>{agent.model}</span>
              {agent.builtin && <span style={{ fontSize: 8, color: "#6ee7b7", fontFamily: FONTS.mono }}>ACTIVE</span>}
            </div>
          </div>
        );
      })}

      {/* Browse VoltAgent repository */}
      <SectionLabel>Browse More</SectionLabel>
      {browseResults.length === 0 ? (
        <button
          onClick={browseRepo}
          disabled={browsing}
          style={{
            display: "flex", alignItems: "center", gap: 6, width: "100%",
            padding: "10px 12px", borderRadius: 5,
            background: "transparent", border: `1px dashed hsl(220 13% 28%)`,
            color: browsing ? C.accent : "hsl(220 14% 50%)",
            fontFamily: FONTS.mono, fontSize: 10, cursor: "pointer",
          }}
        >
          {browsing ? (
            <><Loader2 size={12} className="animate-spin" /> Loading from VoltAgent...</>
          ) : (
            <><Globe size={12} /> Browse VoltAgent agent repository</>
          )}
        </button>
      ) : (
        <div>
          <div style={{ fontSize: 9, color: "hsl(220 14% 45%)", marginBottom: 6 }}>
            {browseResults.length} agents found · Ask the agent-installer to install any of these
          </div>
          {browseResults
            .filter((r) => !searchQuery || r.name.toLowerCase().includes(searchQuery.toLowerCase()))
            .slice(0, 20)
            .map((r) => (
              <div key={`${r.category}-${r.name}`} style={{
                padding: "5px 10px", margin: "2px 0", borderRadius: 4,
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 10, color: "hsl(220 14% 65%)",
              }}>
                <span style={{ color: "hsl(220 14% 40%)", fontFamily: FONTS.mono, fontSize: 8, width: 80, flexShrink: 0, textTransform: "uppercase" }}>
                  {r.category.replace(/-/g, " ").slice(0, 12)}
                </span>
                <span style={{ flex: 1 }}>{r.name}</span>
                <button
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent("pipilot:open-chat"));
                    setTimeout(() => {
                      window.dispatchEvent(new CustomEvent("pipilot:focus-chat-input", {
                        detail: { prefill: `Use the agent-installer to install the "${r.name}" agent from the ${r.category} category`, submit: true },
                      }));
                    }, 200);
                  }}
                  style={{
                    padding: "2px 6px", fontSize: 8, fontFamily: FONTS.mono, fontWeight: 600,
                    background: C.accent, color: "hsl(220 13% 10%)",
                    border: "none", borderRadius: 2, cursor: "pointer", flexShrink: 0,
                  }}
                >Install</button>
              </div>
            ))}
        </div>
      )}

      <div style={{ marginTop: 12, padding: "8px 0", fontSize: 9, color: "hsl(220 14% 40%)", lineHeight: 1.5, fontStyle: "italic" }}>
        Tip: Say "Use the agent-installer to find agents for [topic]" in chat to search and install agents conversationally.
      </div>
    </div>
  );
}

// ── Themes Tab ──
function ThemesTab() {
  const editorThemes = [
    { id: "pipilot-editorial", name: "PiPilot Editorial", description: "Default dark theme with lime accents" },
    { id: "vs-dark", name: "VS Code Dark+", description: "Classic VS Code dark theme" },
    { id: "hc-black", name: "High Contrast", description: "High contrast dark theme for accessibility" },
    { id: "monokai", name: "Monokai", description: "Warm dark theme with vibrant syntax colors", coming: true },
    { id: "dracula", name: "Dracula", description: "Purple-tinted dark theme", coming: true },
    { id: "one-dark", name: "One Dark Pro", description: "Atom-inspired dark theme", coming: true },
    { id: "nord", name: "Nord", description: "Arctic blue-tinted color palette", coming: true },
    { id: "github-dark", name: "GitHub Dark", description: "GitHub's official dark theme", coming: true },
  ];

  const keybindings = [
    { id: "default", name: "Default", description: "PiPilot default keybindings", active: true },
    { id: "vim", name: "Vim", description: "Modal editing with hjkl navigation", coming: true },
    { id: "emacs", name: "Emacs", description: "Emacs-style keybindings", coming: true },
    { id: "sublime", name: "Sublime Text", description: "Sublime Text keybindings", coming: true },
  ];

  const [activeTheme, setActiveTheme] = useState("pipilot-editorial");
  const applyTheme = (themeId: string) => {
    window.dispatchEvent(new CustomEvent("pipilot:monaco-theme-changed", { detail: { theme: themeId } }));
    setActiveTheme(themeId);
    window.dispatchEvent(new CustomEvent("pipilot:notify", {
      detail: { type: "success", title: "Theme Applied", message: themeId },
    }));
  };

  return (
    <div>
      <SectionLabel>Editor Themes</SectionLabel>
      {editorThemes.map((t) => {
        const isActive = t.id === activeTheme;
        return (
          <div key={t.id} style={{
            padding: "7px 10px", margin: "3px 0", borderRadius: 5,
            background: "hsl(220 13% 17%)", border: `1px solid ${isActive ? `${C.accent}40` : "hsl(220 13% 24%)"}`,
            display: "flex", alignItems: "center", gap: 8,
            opacity: t.coming ? 0.5 : 1,
          }}>
            <div style={{
              width: 24, height: 24, borderRadius: 5, flexShrink: 0,
              background: isActive ? `${C.accent}18` : "hsl(220 13% 22%)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Palette size={11} style={{ color: isActive ? C.accent : "hsl(220 14% 50%)" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: isActive ? C.accent : "hsl(220 14% 82%)" }}>{t.name}</div>
              <div style={{ fontSize: 9, color: "hsl(220 14% 45%)" }}>{t.description}</div>
            </div>
            {isActive ? (
              <span style={{ fontSize: 8, color: C.accent, fontFamily: FONTS.mono }}>ACTIVE</span>
            ) : t.coming ? (
              <span style={{ fontSize: 8, color: "hsl(220 14% 40%)", fontFamily: FONTS.mono }}>COMING</span>
            ) : (
              <button onClick={() => applyTheme(t.id)} style={{
                padding: "3px 8px", fontSize: 9, fontFamily: FONTS.mono, fontWeight: 600,
                background: C.accent, color: "hsl(220 13% 10%)",
                border: "none", borderRadius: 3, cursor: "pointer",
              }}>Apply</button>
            )}
          </div>
        );
      })}

      <SectionLabel>Keybinding Presets</SectionLabel>
      {keybindings.map((k) => (
        <div key={k.id} style={{
          padding: "7px 10px", margin: "3px 0", borderRadius: 5,
          background: "hsl(220 13% 17%)", border: `1px solid ${k.active ? `${C.accent}40` : "hsl(220 13% 24%)"}`,
          display: "flex", alignItems: "center", gap: 8,
          opacity: k.coming ? 0.5 : 1,
        }}>
          <div style={{
            width: 24, height: 24, borderRadius: 5, flexShrink: 0,
            background: k.active ? `${C.accent}18` : "hsl(220 13% 22%)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Keyboard size={11} style={{ color: k.active ? C.accent : "hsl(220 14% 50%)" }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: k.active ? C.accent : "hsl(220 14% 82%)" }}>{k.name}</div>
            <div style={{ fontSize: 9, color: "hsl(220 14% 45%)" }}>{k.description}</div>
          </div>
          {k.active ? (
            <span style={{ fontSize: 8, color: C.accent, fontFamily: FONTS.mono }}>ACTIVE</span>
          ) : (
            <span style={{ fontSize: 8, color: "hsl(220 14% 40%)", fontFamily: FONTS.mono }}>COMING</span>
          )}
        </div>
      ))}

      <div style={{ marginTop: 12, padding: "8px 0", fontSize: 9, color: "hsl(220 14% 40%)", lineHeight: 1.5, fontStyle: "italic" }}>
        More themes and customization options coming soon. Snippet packs and icon themes are on the roadmap.
      </div>
    </div>
  );
}
