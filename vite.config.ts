import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";
import path from "path";

// Port config — must match server/config.ts values
const PORT_AGENT = parseInt(process.env.PIPILOT_PORT_AGENT || "51731");
const PORT_CLOUD = parseInt(process.env.PIPILOT_PORT_CLOUD || "51732");
const PORT_VITE = parseInt(process.env.PIPILOT_PORT_VITE || "51730");

// Only include electron plugin when building for desktop
const isElectron = process.env.ELECTRON === "1" || process.argv.includes("--electron");

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(isElectron ? [electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              external: ["node-pty", "electron"],
            },
          },
        },
      },
      preload: {
        input: "electron/preload.ts",
      },
    })] : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: PORT_VITE,
    watch: {
      ignored: ["**/workspaces/**", "**/node_modules/**", "**/PiPilot/**"],
    },
    proxy: {
      "/api/files": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
        // Disable buffering for SSE streaming (file watcher)
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
      "/api/preview": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
      },
      "/api/dev-server": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
      "/api/dev-preview": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
      },
      "/api/terminal": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
      "/api/git": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
      },
      "/api/project": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
      },
      "/api/diagnostics": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
      },
      "/api/checkpoints": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
      },
      "/api/workspaces": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
      },
      "/api/fs": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
      },
      "/api/mcp": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
      },
      "/api/connectors": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
      },
      "/api/cloud": {
        target: `http://localhost:${PORT_CLOUD}`,
        changeOrigin: true,
      },
      "/api/agents": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
      },
      "/api/wiki": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
      },
      "/api/codestral": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
      "/api/agent": {
        target: `http://localhost:${PORT_AGENT}`,
        changeOrigin: true,
        // Disable buffering for SSE streaming
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            // Prevent Vite from buffering the SSE stream
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
  root: path.resolve(import.meta.dirname),
  // Exclude workspace HTML files from dep scanning — they're user projects,
  // not part of the IDE itself. Without this, Vite tries to parse them and
  // fails on syntax errors in user code.
  optimizeDeps: {
    exclude: ["workspaces"],
    entries: ["index.html"],
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, "index.html"),
    },
  },
});
