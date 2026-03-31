export interface FileNode {
  id: string;
  name: string;
  type: "file" | "folder";
  language?: string;
  content?: string;
  children?: FileNode[];
  expanded?: boolean;
}

export const SAMPLE_PROJECT: FileNode[] = [
  {
    id: "src",
    name: "src",
    type: "folder",
    expanded: true,
    children: [
      {
        id: "src/App.tsx",
        name: "App.tsx",
        type: "file",
        language: "typescript",
        content: `import { useState } from "react";
import { Router } from "./Router";
import { ThemeProvider } from "./context/ThemeContext";

function App() {
  const [count, setCount] = useState(0);

  return (
    <ThemeProvider>
      <div className="app-container">
        <header className="app-header">
          <h1>My React App</h1>
          <button onClick={() => setCount(c => c + 1)}>
            Count: {count}
          </button>
        </header>
        <main>
          <Router />
        </main>
      </div>
    </ThemeProvider>
  );
}

export default App;
`,
      },
      {
        id: "src/Router.tsx",
        name: "Router.tsx",
        type: "file",
        language: "typescript",
        content: `import { Switch, Route } from "wouter";
import Home from "./pages/Home";
import About from "./pages/About";
import NotFound from "./pages/NotFound";

export function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/about" component={About} />
      <Route component={NotFound} />
    </Switch>
  );
}
`,
      },
      {
        id: "src/pages",
        name: "pages",
        type: "folder",
        expanded: false,
        children: [
          {
            id: "src/pages/Home.tsx",
            name: "Home.tsx",
            type: "file",
            language: "typescript",
            content: `import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="home-page">
      <h2>Welcome Home</h2>
      <p>This is the home page of the application.</p>
      <Link href="/about">
        <Button variant="outline">About Us</Button>
      </Link>
    </div>
  );
}
`,
          },
          {
            id: "src/pages/About.tsx",
            name: "About.tsx",
            type: "file",
            language: "typescript",
            content: `export default function About() {
  return (
    <div className="about-page">
      <h2>About</h2>
      <p>
        This is a sample React + TypeScript application built with Vite,
        Tailwind CSS, and shadcn/ui components.
      </p>
      <ul>
        <li>React 19</li>
        <li>TypeScript 5.9</li>
        <li>Tailwind CSS v4</li>
        <li>Vite 6</li>
      </ul>
    </div>
  );
}
`,
          },
        ],
      },
      {
        id: "src/hooks",
        name: "hooks",
        type: "folder",
        expanded: false,
        children: [
          {
            id: "src/hooks/useLocalStorage.ts",
            name: "useLocalStorage.ts",
            type: "file",
            language: "typescript",
            content: `import { useState, useEffect } from "react";

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(error);
    }
  };

  return [storedValue, setValue] as const;
}

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}
`,
          },
        ],
      },
      {
        id: "src/utils.ts",
        name: "utils.ts",
        type: "file",
        language: "typescript",
        content: `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}
`,
      },
    ],
  },
  {
    id: "package.json",
    name: "package.json",
    type: "file",
    language: "json",
    content: `{
  "name": "my-react-app",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "wouter": "^3.3.5",
    "@tanstack/react-query": "^5.0.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.4",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.3",
    "vite": "^6.0.7",
    "tailwindcss": "^4.0.0"
  }
}
`,
  },
  {
    id: "tsconfig.json",
    name: "tsconfig.json",
    type: "file",
    language: "json",
    content: `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
`,
  },
  {
    id: "vite.config.ts",
    name: "vite.config.ts",
    type: "file",
    language: "typescript",
    content: `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
`,
  },
  {
    id: "README.md",
    name: "README.md",
    type: "file",
    language: "markdown",
    content: `# My React App

A modern React application built with TypeScript, Vite, and Tailwind CSS.

## Getting Started

\`\`\`bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
\`\`\`

## Tech Stack

- **React 19** — UI framework
- **TypeScript** — Type-safe JavaScript
- **Vite** — Lightning-fast build tool
- **Tailwind CSS v4** — Utility-first styling
- **Wouter** — Lightweight routing
- **TanStack Query** — Data fetching and caching
- **Zod** — Schema validation

## Project Structure

\`\`\`
src/
├── App.tsx         # Root component
├── Router.tsx      # Route definitions
├── pages/          # Page components
│   ├── Home.tsx
│   └── About.tsx
├── hooks/          # Custom React hooks
│   └── useLocalStorage.ts
└── utils.ts        # Utility functions
\`\`\`

## License

MIT
`,
  },
];

export function findFileById(nodes: FileNode[], id: string): FileNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findFileById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function getFileIcon(name: string, type: "file" | "folder"): string {
  if (type === "folder") return "folder";
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "tsx":
    case "jsx":
      return "react";
    case "ts":
    case "js":
      return "typescript";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "css":
      return "css";
    case "html":
      return "html";
    default:
      return "file";
  }
}

export function getLanguageFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "tsx":
    case "jsx":
      return "typescript";
    case "ts":
      return "typescript";
    case "js":
      return "javascript";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "css":
      return "css";
    case "html":
      return "html";
    case "sh":
      return "shell";
    default:
      return "plaintext";
  }
}
