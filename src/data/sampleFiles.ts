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
    id: "index.html",
    name: "index.html",
    type: "file",
    language: "html",
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Web App</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="styles.css" />
</head>
<body class="bg-gray-50 text-gray-900 min-h-screen">
  <nav class="bg-white shadow-sm border-b">
    <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
      <h1 class="text-xl font-bold text-blue-600">My App</h1>
      <div class="flex gap-4">
        <a href="#home" class="text-gray-600 hover:text-blue-600 transition" data-page="home">Home</a>
        <a href="#about" class="text-gray-600 hover:text-blue-600 transition" data-page="about">About</a>
      </div>
    </div>
  </nav>

  <main id="app" class="max-w-5xl mx-auto px-4 py-8">
    <!-- Content loaded by router -->
  </main>

  <footer class="border-t mt-auto py-4 text-center text-sm text-gray-400">
    Built with HTML, CSS & JavaScript
  </footer>

  <script src="app.js"></script>
</body>
</html>
`,
  },
  {
    id: "styles.css",
    name: "styles.css",
    type: "file",
    language: "css",
    content: `/* Custom styles beyond Tailwind */
.fade-in {
  animation: fadeIn 0.3s ease-in-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  padding: 1.5rem;
  transition: box-shadow 0.2s;
}

.card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-weight: 500;
  transition: all 0.2s;
  cursor: pointer;
  border: none;
}

.btn-primary {
  background: #2563eb;
  color: white;
}

.btn-primary:hover {
  background: #1d4ed8;
}
`,
  },
  {
    id: "app.js",
    name: "app.js",
    type: "file",
    language: "javascript",
    content: `// Simple page router
const pages = {
  home: \`
    <div class="fade-in">
      <h2 class="text-3xl font-bold mb-4">Welcome Home</h2>
      <p class="text-gray-600 mb-6">This is a sample web application built with HTML, CSS, and JavaScript.</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="card">
          <h3 class="font-semibold text-lg mb-2">Fast</h3>
          <p class="text-gray-500">No build step needed. Just edit and refresh.</p>
        </div>
        <div class="card">
          <h3 class="font-semibold text-lg mb-2">Simple</h3>
          <p class="text-gray-500">Pure HTML, CSS, and JavaScript. No frameworks.</p>
        </div>
      </div>
      <button class="btn btn-primary mt-6" onclick="navigate('about')">Learn More</button>
    </div>
  \`,
  about: \`
    <div class="fade-in">
      <h2 class="text-3xl font-bold mb-4">About</h2>
      <p class="text-gray-600 mb-4">A simple web app using the Tailwind CSS CDN for styling.</p>
      <ul class="space-y-2 text-gray-600">
        <li>✓ HTML5</li>
        <li>✓ CSS3 + Tailwind</li>
        <li>✓ Vanilla JavaScript</li>
        <li>✓ No build tools required</li>
      </ul>
    </div>
  \`,
};

function navigate(page) {
  window.location.hash = page;
}

function render() {
  const hash = window.location.hash.slice(1) || "home";
  const app = document.getElementById("app");
  app.innerHTML = pages[hash] || pages.home;

  // Update active nav link
  document.querySelectorAll("[data-page]").forEach(link => {
    const isActive = link.dataset.page === hash;
    link.classList.toggle("text-blue-600", isActive);
    link.classList.toggle("font-semibold", isActive);
    link.classList.toggle("text-gray-600", !isActive);
  });
}

window.addEventListener("hashchange", render);
render();
`,
  },
  {
    id: "README.md",
    name: "README.md",
    type: "file",
    language: "markdown",
    content: `# My Web App

A simple web application built with HTML, CSS, and JavaScript.

## Stack

- **HTML5** — Structure
- **CSS3 + Tailwind CDN** — Styling
- **Vanilla JavaScript** — Interactivity

## Getting Started

Just open \`index.html\` in a browser. No build step needed.
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
