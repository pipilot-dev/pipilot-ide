import { useEffect, useRef, useState, useCallback } from "react";
import { Nodebox } from "@codesandbox/nodebox";
import { FileNode } from "@/hooks/useFileSystem";
import { RefreshCw, ExternalLink, Play } from "lucide-react";

interface NodeboxPreviewProps {
  files: FileNode[];
}

export function NodeboxPreview({ files }: NodeboxPreviewProps) {
  const runtimeRef = useRef<HTMLIFrameElement>(null);
  const previewRef = useRef<HTMLIFrameElement>(null);
  const nodeboxRef = useRef<Nodebox | null>(null);
  const [status, setStatus] = useState<"idle" | "booting" | "syncing" | "running" | "ready" | "error">("idle");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState("");

  // Flatten files to a map for Nodebox fs.init
  const flattenFiles = useCallback((nodes: FileNode[]): Record<string, string> => {
    const result: Record<string, string> = {};
    function walk(items: FileNode[]) {
      for (const item of items) {
        if (item.type === "file" && item.content != null) {
          result[item.id] = item.content;
        }
        if (item.children) walk(item.children);
      }
    }
    walk(nodes);
    return result;
  }, []);

  const startPreview = useCallback(async () => {
    if (!runtimeRef.current) return;

    try {
      setStatus("booting");
      setErrorMsg("");
      setPreviewUrl("");

      // Create Nodebox with the runtime iframe
      const nodebox = new Nodebox({ iframe: runtimeRef.current });
      await nodebox.connect();
      nodeboxRef.current = nodebox;

      // Sync files
      setStatus("syncing");
      const fileMap = flattenFiles(files);
      await nodebox.fs.init(fileMap);

      // Determine what to run and which port to watch
      setStatus("running");
      let entryFile = "server.js";
      let port = 3000;

      try {
        const pkgJson = fileMap["package.json"];
        if (pkgJson) {
          const pkg = JSON.parse(pkgJson);
          // Extract entry file from scripts
          const devScript = pkg.scripts?.dev || pkg.scripts?.start || "";
          const nodeMatch = devScript.match(/node\s+(\S+)/);
          if (nodeMatch) entryFile = nodeMatch[1];
          // Try to find port from scripts or main
          const portMatch = devScript.match(/(?:port|PORT)[=\s]+(\d+)/i);
          if (portMatch) port = parseInt(portMatch[1]);
          // Fallback to main field
          if (pkg.main && !nodeMatch) entryFile = pkg.main;
        }
      } catch {}

      // Also check if entry file exists, try common fallbacks
      const entryFiles = [entryFile, "server.js", "index.js", "app.js", "src/index.js"];
      let resolvedEntry = entryFile;
      for (const f of entryFiles) {
        if (fileMap[f]) { resolvedEntry = f; break; }
      }

      // Run the entry file directly (npm is not available in Nodebox)
      const shell = nodebox.shell.create();
      shell.runCommand("node", [resolvedEntry]);

      // Wait for the server to start listening on a port
      const previewInfo = await nodebox.preview.waitForPort(port, 20000);
      setPreviewUrl(previewInfo.url);
      setStatus("ready");

      // Mount preview
      if (previewRef.current) {
        previewRef.current.src = previewInfo.url;
      }
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err?.message || String(err));
    }
  }, [files, flattenFiles]);

  // Auto-start on mount
  useEffect(() => {
    if (files.length > 0 && status === "idle") {
      startPreview();
    }
  }, [files.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = useCallback(() => {
    if (previewRef.current && previewUrl) {
      previewRef.current.src = previewUrl;
    } else {
      startPreview();
    }
  }, [previewUrl, startPreview]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "hsl(220 13% 14%)" }}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
        borderBottom: "1px solid hsl(220 13% 22%)",
        background: "hsl(220 13% 18%)",
        height: 32, minHeight: 32,
      }}>
        <button onClick={handleRefresh} title="Refresh"
          style={{ background: "none", border: "none", color: "hsl(220 14% 60%)", cursor: "pointer", padding: 4 }}>
          <RefreshCw size={13} />
        </button>
        <div style={{
          flex: 1, padding: "2px 10px", fontSize: 11, borderRadius: 4,
          background: "hsl(220 13% 14%)", color: "hsl(220 14% 50%)",
          border: "1px solid hsl(220 13% 22%)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {previewUrl || (status === "idle" ? "Click play to start" : status + "...")}
        </div>
        {previewUrl && (
          <button onClick={() => window.open(previewUrl, "_blank")} title="Open in new tab"
            style={{ background: "none", border: "none", color: "hsl(220 14% 60%)", cursor: "pointer", padding: 4 }}>
            <ExternalLink size={13} />
          </button>
        )}
        {status !== "running" && status !== "booting" && status !== "syncing" && (
          <button onClick={startPreview} title="Start/Restart"
            style={{ background: "none", border: "none", color: "hsl(142 71% 50%)", cursor: "pointer", padding: 4 }}>
            <Play size={13} />
          </button>
        )}
      </div>

      {/* Status overlay */}
      {status !== "ready" && status !== "idle" && (
        <div style={{
          padding: 20, textAlign: "center", color: "hsl(220 14% 55%)", fontSize: 12,
        }}>
          {status === "booting" && "Booting Nodebox runtime..."}
          {status === "syncing" && "Syncing project files..."}
          {status === "running" && "Starting dev server..."}
          {status === "error" && (
            <div>
              <div style={{ color: "hsl(0 84% 60%)", marginBottom: 8 }}>Failed to start preview</div>
              <div style={{ fontSize: 11, color: "hsl(220 14% 45%)" }}>{errorMsg}</div>
              <button onClick={startPreview} style={{
                marginTop: 12, padding: "6px 16px", fontSize: 11,
                background: "hsl(207 90% 54%)", color: "#fff",
                border: "none", borderRadius: 4, cursor: "pointer",
              }}>Retry</button>
            </div>
          )}
        </div>
      )}

      {/* Hidden runtime iframe (Nodebox runs here) */}
      <iframe
        ref={runtimeRef}
        style={{ display: "none" }}
        title="Nodebox Runtime"
      />

      {/* Visible preview iframe */}
      <iframe
        ref={previewRef}
        style={{
          flex: 1, border: "none", width: "100%",
          display: status === "ready" ? "block" : "none",
          background: "#fff",
        }}
        title="Node.js Preview"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      />
    </div>
  );
}
