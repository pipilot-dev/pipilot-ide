import { useMemo } from "react";
import {
  SandpackProvider,
  SandpackPreview,
} from "@codesandbox/sandpack-react";
import { FileNode } from "@/hooks/useFileSystem";

interface WebPreviewProps {
  files: FileNode[];
}

const WEB_EXTENSIONS = new Set([".html", ".css", ".js", ".svg", ".json"]);

function getExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i) : "";
}

/** Flatten file tree → { "/index.html": { code } } */
function flattenToSandpack(nodes: FileNode[]): Record<string, { code: string }> {
  const out: Record<string, { code: string }> = {};
  for (const node of nodes) {
    if (node.type === "file" && node.content != null && WEB_EXTENSIONS.has(getExt(node.name))) {
      const key = node.id.startsWith("/") ? node.id : `/${node.id}`;
      out[key] = { code: node.content };
    }
    if (node.children) Object.assign(out, flattenToSandpack(node.children));
  }
  return out;
}

export function WebPreview({ files }: WebPreviewProps) {
  const spFiles = useMemo(() => {
    const flat = flattenToSandpack(files);

    // Ensure /index.html exists
    if (!flat["/index.html"]) {
      flat["/index.html"] = {
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

    return flat;
  }, [files]);

  return (
    <SandpackProvider
      template="static"
      files={spFiles}
      theme="dark"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <SandpackPreview
        showNavigator
        showRefreshButton
        showOpenInCodeSandbox={false}
        style={{ flex: 1, minHeight: 0 }}
      />
    </SandpackProvider>
  );
}
