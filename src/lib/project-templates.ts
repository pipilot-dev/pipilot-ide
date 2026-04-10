/**
 * Project seed templates for different frameworks.
 * Each template returns an array of files to populate a new project.
 */

interface SeedFile {
  id: string;
  name: string;
  type: "file" | "folder";
  parentPath: string;
  language: string;
  content: string;
}

export type ProjectTemplate = "static" | "node" | "vite-react" | "nextjs" | "express";

export const TEMPLATE_INFO: Record<ProjectTemplate, { label: string; description: string; color: string }> = {
  static: { label: "HTML/CSS/JS", description: "Static site with Tailwind CDN", color: "hsl(207 90% 54%)" },
  node: { label: "Node.js", description: "Basic Node.js project", color: "hsl(142 71% 45%)" },
  "vite-react": { label: "Vite + React", description: "React app with Vite, HMR, Tailwind", color: "hsl(191 91% 50%)" },
  nextjs: { label: "Next.js", description: "Full-stack React framework with SSR", color: "hsl(0 0% 85%)" },
  express: { label: "Express", description: "Express.js REST API server", color: "hsl(38 92% 50%)" },
};

export function getSeedFiles(name: string, template: ProjectTemplate): SeedFile[] {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  switch (template) {
    case "vite-react":
      return viteReactTemplate(name, slug);
    case "nextjs":
      return nextjsTemplate(name, slug);
    case "express":
      return expressTemplate(name, slug);
    case "node":
      return nodeTemplate(name, slug);
    case "static":
    default:
      return staticTemplate(name);
  }
}

// ─── Shared config snippets ──────────────────────────────────────

const STANDARD_GITIGNORE = `node_modules/
.next/
out/
dist/
build/
.cache/
.vite/
coverage/
.DS_Store
*.log
.env
.env.local
.env.*.local
.pipilot-tsconfig.json
`;

function gitignoreFile(): SeedFile {
  return {
    id: ".gitignore", name: ".gitignore", type: "file",
    parentPath: "", language: "plaintext", content: STANDARD_GITIGNORE,
  };
}

/**
 * jsconfig.json gives JS projects type-checking + path aliasing in the
 * editor and server-side diagnostics, without forcing them to be TS.
 * Tailored per framework so paths/include match conventions.
 */
function jsconfigFile(framework: ProjectTemplate): SeedFile {
  let paths: Record<string, string[]>;
  let include: string[];
  let baseUrl = ".";

  switch (framework) {
    case "vite-react":
      // Vite convention: source in src/, alias @/ → ./src/
      paths = { "@/*": ["./src/*"] };
      include = ["src/**/*.js", "src/**/*.jsx", "src/**/*.mjs", "vite.config.js"];
      break;
    case "nextjs":
      // Next.js (App Router at root) convention: alias @/ → root
      paths = { "@/*": ["./*"] };
      include = ["next-env.d.ts", "**/*.js", "**/*.jsx", "**/*.mjs"];
      break;
    case "express":
      // Express: no aliases, just root
      paths = {};
      include = ["**/*.js", "**/*.mjs"];
      break;
    case "node":
    default:
      paths = {};
      include = ["**/*.js", "**/*.mjs"];
      break;
  }

  const compilerOptions: Record<string, unknown> = {
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    jsx: "preserve",
    lib: ["dom", "dom.iterable", "esnext"],
    allowJs: true,
    checkJs: false,
    esModuleInterop: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    isolatedModules: true,
    noEmit: true,
    baseUrl,
  };
  if (Object.keys(paths).length > 0) compilerOptions.paths = paths;

  return {
    id: "jsconfig.json", name: "jsconfig.json", type: "file",
    parentPath: "", language: "json",
    content: JSON.stringify({
      compilerOptions,
      include,
      exclude: ["node_modules", "dist", "build", ".next", "out", ".pipilot-tsconfig.json"],
    }, null, 2),
  };
}

/** Next.js specific environment types declaration file */
function nextEnvDtsFile(): SeedFile {
  return {
    id: "next-env.d.ts", name: "next-env.d.ts", type: "file",
    parentPath: "", language: "typescript",
    content: `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n\n// NOTE: This file should not be edited\n// see https://nextjs.org/docs/app/building-your-application/configuring/typescript for more information.\n`,
  };
}

/** Vite client environment types declaration file */
function viteEnvDtsFile(): SeedFile {
  return {
    id: "src/vite-env.d.ts", name: "vite-env.d.ts", type: "file",
    parentPath: "src", language: "typescript",
    content: `/// <reference types="vite/client" />\n`,
  };
}

function tsconfigFile(): SeedFile {
  return {
    id: "tsconfig.json", name: "tsconfig.json", type: "file",
    parentPath: "", language: "json",
    content: JSON.stringify({
      compilerOptions: {
        target: "esnext",
        module: "esnext",
        moduleResolution: "bundler",
        jsx: "preserve",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        resolveJsonModule: true,
        isolatedModules: true,
        incremental: true,
        baseUrl: ".",
        paths: { "@/*": ["./*"] },
      },
      include: ["**/*.ts", "**/*.tsx", "next-env.d.ts"],
      exclude: ["node_modules", "dist", "build", ".next", "out"],
    }, null, 2),
  };
}

function readmeFile(name: string, template: ProjectTemplate): SeedFile {
  const cmd = template === "static" ? "Open in preview" : "pnpm install && pnpm dev";
  return {
    id: "README.md", name: "README.md", type: "file",
    parentPath: "", language: "markdown",
    content: `# ${name}\n\nBuilt with PiPilot IDE.\n\n## Getting started\n\n\`\`\`bash\n${cmd}\n\`\`\`\n`,
  };
}

// ─── Static HTML/CSS/JS ─────────────────────────────────────────────

function staticTemplate(name: string): SeedFile[] {
  return [
    gitignoreFile(),
    readmeFile(name, "static"),
    { id: "index.html", name: "index.html", type: "file", parentPath: "", language: "html", content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name}</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <h1>Welcome to ${name}</h1>
  <p>Start building your project here.</p>
  <script src="script.js"></script>
</body>
</html>` },
    { id: "style.css", name: "style.css", type: "file", parentPath: "", language: "css", content: `body {
  font-family: system-ui, sans-serif;
  margin: 0;
  padding: 2rem;
  background: #1a1a2e;
  color: #eee;
}

h1 { color: #e94560; }` },
    { id: "script.js", name: "script.js", type: "file", parentPath: "", language: "javascript", content: `// ${name}\nconsole.log("Hello from ${name}!");\n` },
  ];
}

// ─── Basic Node.js ──────────────────────────────────────────────────

function nodeTemplate(name: string, slug: string): SeedFile[] {
  return [
    gitignoreFile(),
    readmeFile(name, "node"),
    jsconfigFile("node"),
    { id: "package.json", name: "package.json", type: "file", parentPath: "", language: "json", content: JSON.stringify({
      name: slug, version: "1.0.0", private: true,
      scripts: { dev: "node server.js", start: "node server.js" },
      dependencies: {},
    }, null, 2) },
    { id: "server.js", name: "server.js", type: "file", parentPath: "", language: "javascript", content: `const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(\`<!DOCTYPE html>
<html><head><title>${name}</title></head>
<body><h1>${name}</h1><p>Node.js server running!</p></body>
</html>\`);
});

server.listen(3000, '0.0.0.0', () => {
  console.log('Server running on http://localhost:3000');
});
` },
    { id: "index.js", name: "index.js", type: "file", parentPath: "", language: "javascript", content: `console.log("Hello from ${name}!");\n` },
  ];
}

// ─── Vite + React ───────────────────────────────────────────────────

function viteReactTemplate(name: string, slug: string): SeedFile[] {
  return [
    gitignoreFile(),
    readmeFile(name, "vite-react"),
    jsconfigFile("vite-react"),
    viteEnvDtsFile(),
    { id: "package.json", name: "package.json", type: "file", parentPath: "", language: "json", content: JSON.stringify({
      name: slug, version: "1.0.0", private: true, type: "module",
      scripts: {
        dev: "vite --host 0.0.0.0",
        build: "vite build",
        preview: "vite preview",
      },
      dependencies: {
        react: "^19.0.0",
        "react-dom": "^19.0.0",
      },
      devDependencies: {
        "@vitejs/plugin-react": "^4.3.0",
        vite: "^6.0.0",
      },
    }, null, 2) },
    { id: "vite.config.js", name: "vite.config.js", type: "file", parentPath: "", language: "javascript", content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    cors: true,
    allowedHosts: ['.e2b.app'],
  },
})
` },
    { id: "index.html", name: "index.html", type: "file", parentPath: "", language: "html", content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name}</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>` },
    // src/ folder
    { id: "src", name: "src", type: "folder", parentPath: "", language: "", content: "" },
    { id: "src/main.jsx", name: "main.jsx", type: "file", parentPath: "src", language: "javascript", content: `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
` },
    { id: "src/App.jsx", name: "App.jsx", type: "file", parentPath: "src", language: "javascript", content: `import { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', background: '#0a0a0a', color: '#ededed' }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>${name}</h1>
      <p style={{ color: '#888', marginBottom: '2rem' }}>Built with Vite + React</p>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <button onClick={() => setCount(c => c - 1)} style={{ padding: '0.5rem 1.5rem', fontSize: '1.2rem', borderRadius: '8px', border: '1px solid #333', background: '#1a1a1a', color: '#fff', cursor: 'pointer' }}>−</button>
        <span style={{ fontSize: '3rem', fontWeight: 'bold', minWidth: '80px', textAlign: 'center' }}>{count}</span>
        <button onClick={() => setCount(c => c + 1)} style={{ padding: '0.5rem 1.5rem', fontSize: '1.2rem', borderRadius: '8px', border: '1px solid #333', background: '#1a1a1a', color: '#fff', cursor: 'pointer' }}>+</button>
      </div>
    </div>
  )
}
` },
    { id: "src/index.css", name: "index.css", type: "file", parentPath: "src", language: "css", content: `* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: system-ui, -apple-system, sans-serif; }
` },
  ];
}

// ─── Next.js ────────────────────────────────────────────────────────

function nextjsTemplate(name: string, slug: string): SeedFile[] {
  return [
    gitignoreFile(),
    readmeFile(name, "nextjs"),
    jsconfigFile("nextjs"),
    nextEnvDtsFile(),
    { id: "package.json", name: "package.json", type: "file", parentPath: "", language: "json", content: JSON.stringify({
      name: slug, version: "1.0.0", private: true,
      scripts: {
        dev: "next dev -H 0.0.0.0 -p 3000",
        build: "next build",
        start: "next start",
      },
      dependencies: {
        next: "^15.0.0",
        react: "^19.0.0",
        "react-dom": "^19.0.0",
      },
    }, null, 2) },
    { id: "next.config.mjs", name: "next.config.mjs", type: "file", parentPath: "", language: "javascript", content: `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ['https://*.e2b.app'],
}

export default nextConfig
` },
    // app/ folder (App Router)
    { id: "app", name: "app", type: "folder", parentPath: "", language: "", content: "" },
    { id: "app/layout.jsx", name: "layout.jsx", type: "file", parentPath: "app", language: "javascript", content: `export const metadata = {
  title: '${name}',
  description: 'Built with Next.js on PiPilot IDE',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0a0a0a', color: '#ededed' }}>
        {children}
      </body>
    </html>
  )
}
` },
    { id: "app/page.jsx", name: "page.jsx", type: "file", parentPath: "app", language: "javascript", content: `'use client'
import { useState } from 'react'

export default function Home() {
  const [count, setCount] = useState(0)

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>${name}</h1>
      <p style={{ color: '#888', marginBottom: '2rem' }}>Built with Next.js</p>
      <button
        onClick={() => setCount(c => c + 1)}
        style={{ padding: '0.75rem 2rem', fontSize: '1rem', borderRadius: '8px', border: '1px solid #333', background: '#1a1a1a', color: '#fff', cursor: 'pointer' }}
      >
        Clicked {count} times
      </button>
    </main>
  )
}
` },
    { id: "app/globals.css", name: "globals.css", type: "file", parentPath: "app", language: "css", content: `* { margin: 0; padding: 0; box-sizing: border-box; }
` },
  ];
}

// ─── Express ────────────────────────────────────────────────────────

function expressTemplate(name: string, slug: string): SeedFile[] {
  return [
    gitignoreFile(),
    readmeFile(name, "express"),
    jsconfigFile("express"),
    { id: "package.json", name: "package.json", type: "file", parentPath: "", language: "json", content: JSON.stringify({
      name: slug, version: "1.0.0", private: true,
      scripts: {
        dev: "node server.js",
        start: "node server.js",
      },
      dependencies: {
        express: "^4.21.0",
        cors: "^2.8.5",
      },
    }, null, 2) },
    { id: "server.js", name: "server.js", type: "file", parentPath: "", language: "javascript", content: `const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API routes
app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from ${name}!', timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'running', uptime: process.uptime() });
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(\`${name} server running on http://localhost:\${PORT}\`);
});
` },
    // public/ folder
    { id: "public", name: "public", type: "folder", parentPath: "", language: "", content: "" },
    { id: "public/index.html", name: "index.html", type: "file", parentPath: "public", language: "html", content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #ededed; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { text-align: center; }
    h1 { font-size: 2.5rem; margin-bottom: 1rem; }
    #response { margin-top: 1.5rem; padding: 1rem; background: #1a1a1a; border-radius: 8px; font-family: monospace; }
    button { padding: 0.5rem 1.5rem; font-size: 1rem; border-radius: 8px; border: 1px solid #333; background: #1a1a1a; color: #fff; cursor: pointer; margin-top: 1rem; }
    button:hover { background: #222; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${name}</h1>
    <p style="color: #888">Express.js API Server</p>
    <button onclick="fetchApi()">Call /api/hello</button>
    <pre id="response">Click the button to call the API</pre>
  </div>
  <script>
    async function fetchApi() {
      const res = await fetch('/api/hello');
      const data = await res.json();
      document.getElementById('response').textContent = JSON.stringify(data, null, 2);
    }
  </script>
</body>
</html>` },
  ];
}
