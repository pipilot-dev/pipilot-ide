import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    watch: {
      ignored: ["**/workspaces/**", "**/node_modules/**"],
    },
    proxy: {
      "/api/files": {
        target: "http://localhost:3001",
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
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/api/dev-server": {
        target: "http://localhost:3001",
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
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/api/terminal": {
        target: "http://localhost:3001",
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
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/api/project": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/api/diagnostics": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/api/workspaces": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/api/fs": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/api/agent": {
        target: "http://localhost:3001",
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
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
});
