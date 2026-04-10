import { useMemo, useEffect, useRef } from "react";
import {
  SandpackProvider,
  SandpackPreview,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { FileNode } from "@/hooks/useFileSystem";
import { CloudPreview } from "./CloudPreview";
import { DevServerPreview } from "./DevServerPreview";

interface WebPreviewProps {
  files: FileNode[];
  projectType?: "static" | "nodebox" | "cloud";
}

const WEB_EXTENSIONS = new Set([
  ".html", ".htm", ".css", ".js", ".mjs", ".jsx",
  ".svg", ".json", ".ts", ".tsx", ".md", ".xml", ".txt",
]);

function getExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i) : "";
}

/** Flatten file tree → { "/index.html": { code } } */
function flattenToSandpack(nodes: FileNode[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const node of nodes) {
    if (node.type === "file" && node.content != null && WEB_EXTENSIONS.has(getExt(node.name))) {
      const key = node.id.startsWith("/") ? node.id : `/${node.id}`;
      out[key] = node.content;
    }
    if (node.children) Object.assign(out, flattenToSandpack(node.children));
  }
  return out;
}

/**
 * Inner component that syncs IndexedDB file changes to Sandpack
 * incrementally via updateFile/addFile/deleteFile — no full remount.
 */
function FileSyncer({ files }: { files: FileNode[] }) {
  const { sandpack } = useSandpack();
  const prevFilesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const current = flattenToSandpack(files);
    const prev = prevFilesRef.current;

    // Collect all changes first
    const updates: [string, string][] = [];
    const deletes: string[] = [];

    for (const [filePath, code] of Object.entries(current)) {
      if (prev[filePath] !== code) {
        updates.push([filePath, code]);
      }
    }
    for (const filePath of Object.keys(prev)) {
      if (!(filePath in current)) {
        deletes.push(filePath);
      }
    }

    // Apply all changes, trigger preview refresh on the last one
    if (updates.length > 0 || deletes.length > 0) {
      for (let i = 0; i < updates.length; i++) {
        const isLast = i === updates.length - 1 && deletes.length === 0;
        sandpack.updateFile(updates[i][0], updates[i][1], isLast);
      }
      for (let i = 0; i < deletes.length; i++) {
        const isLast = i === deletes.length - 1;
        sandpack.deleteFile(deletes[i], isLast);
      }
    }

    prevFilesRef.current = current;
  }, [files, sandpack]);

  return null;
}

export function WebPreview({ files, projectType = "static" }: WebPreviewProps) {
  // For cloud/nodebox projects, use the local dev server preview
  if (projectType === "cloud" || projectType === "nodebox") {
    return <DevServerPreview />;
  }

  const isNode = projectType === "nodebox";

  // Initial files — only used on first mount. Updates go through FileSyncer.
  const initialFiles = useMemo(() => {
    const flat = flattenToSandpack(files);
    const spFiles: Record<string, { code: string }> = {};

    for (const [path, code] of Object.entries(flat)) {
      spFiles[path] = { code };
    }

    if (isNode) {
      if (!spFiles["/package.json"]) {
        spFiles["/package.json"] = {
          code: JSON.stringify({ name: "project", version: "1.0.0", dependencies: {} }, null, 2),
        };
      }
      if (!spFiles["/index.js"] && !spFiles["/server.js"] && !spFiles["/app.js"]) {
        spFiles["/index.js"] = { code: `console.log("Hello from Node.js!");\n` };
      }
    } else {
      if (!spFiles["/index.html"]) {
        spFiles["/index.html"] = {
          code: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <h1>No index.html found</h1>
  <p>Create an index.html file to see your app here.</p>
  <script src="/script.js"></script>
</body>
</html>`,
        };
      }
    }

    return spFiles;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNode]); // Only recompute on project type change, not on every file edit

  return (
    <SandpackProvider
      template={isNode ? "node" : "static"}
      files={initialFiles}
      theme="dark"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <FileSyncer files={files} />
      <SandpackPreview
        showNavigator
        showRefreshButton
        showOpenInCodeSandbox={false}
        style={{ flex: 1, minHeight: 0 }}
      />
    </SandpackProvider>
  );
}
