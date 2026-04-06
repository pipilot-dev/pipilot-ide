import { useState, useCallback, useRef, useEffect } from "react";
import { db } from "@/lib/db";

export type ChatMode = "chat" | "agent";

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  status: "pending" | "running" | "done" | "error";
}

export interface BuiltinToolStatus {
  name: string;
  type: "tool_start" | "tool_done";
  arguments?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  streaming?: boolean;
  timestamp: Date;
  toolCalls?: ToolCallInfo[];
  builtinToolStatuses?: BuiltinToolStatus[];
  tool_call_id?: string;
  checkpointId?: string; // checkpoint created after this conversation turn
}

const API_URL = "https://the3rdacademy.com/api/chat/completions";

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

// Known file tools that we execute client-side
const LOCAL_TOOL_NAMES = new Set([
  "read_file", "list_files", "edit_file", "create_file",
  "delete_file", "search_files", "get_file_info", "deploy_site",
  "rename_file", "copy_file", "batch_create_files", "get_project_tree",
  "screenshot_preview",
]);

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

// OpenAI-format tool definitions sent to the server so it can forward them to task_agent/Kilo
const FILE_TOOLS = [
  { type: "function", function: { name: "read_file", description: "Read file contents (up to 500 lines). IMPORTANT: path must be relative with NO leading slash. Use 'app.js' NOT '/app.js'. Use startLine/endLine for ranges.", parameters: { type: "object", properties: { path: { type: "string", description: "Relative file path, e.g. 'app.js' or 'src/utils.js'. NO leading slash." }, startLine: { type: "number" }, endLine: { type: "number" } }, required: ["path"] } } },
  { type: "function", function: { name: "list_files", description: "List files and directories. IMPORTANT: path must be relative. Use '' for root, 'src' for src folder. NO leading slash.", parameters: { type: "object", properties: { path: { type: "string", description: "Relative directory path. Use '' for root. NO leading slash." }, offset: { type: "number" } }, required: ["path"] } } },
  { type: "function", function: { name: "create_file", description: "Create a new file with content. Parent dirs auto-created. Path must be relative: 'app.js' NOT '/app.js'.", parameters: { type: "object", properties: { path: { type: "string", description: "Relative file path. NO leading slash." }, content: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "edit_file", description: "Edit a file. Use search/replace for partial edits or newContent for full rewrite. Path must be relative.", parameters: { type: "object", properties: { path: { type: "string", description: "Relative file path. NO leading slash." }, search: { type: "string" }, replace: { type: "string" }, newContent: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "delete_file", description: "Delete a file or directory. Path must be relative.", parameters: { type: "object", properties: { path: { type: "string", description: "Relative file path. NO leading slash." } }, required: ["path"] } } },
  { type: "function", function: { name: "search_files", description: "Search files by name or content.", parameters: { type: "object", properties: { query: { type: "string" }, path: { type: "string", description: "Optional relative directory to search in. NO leading slash." }, searchContents: { type: "boolean" } }, required: ["query"] } } },
  { type: "function", function: { name: "deploy_site", description: "Deploy the current project to a live URL. Call this after building the site to make it publicly accessible.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "rename_file", description: "Rename or move a file/folder to a new path. Paths must be relative.", parameters: { type: "object", properties: { oldPath: { type: "string", description: "Current relative path. NO leading slash." }, newPath: { type: "string", description: "New relative path. NO leading slash." } }, required: ["oldPath", "newPath"] } } },
  { type: "function", function: { name: "copy_file", description: "Copy a file to a new location. Paths must be relative.", parameters: { type: "object", properties: { srcPath: { type: "string", description: "Source relative path. NO leading slash." }, destPath: { type: "string", description: "Destination relative path. NO leading slash." } }, required: ["srcPath", "destPath"] } } },
  { type: "function", function: { name: "batch_create_files", description: "Create multiple files at once. More efficient than multiple create_file calls. All paths must be relative.", parameters: { type: "object", properties: { files: { type: "array", items: { type: "object", properties: { path: { type: "string", description: "Relative file path. NO leading slash." }, content: { type: "string" } }, required: ["path", "content"] } } }, required: ["files"] } } },
  { type: "function", function: { name: "get_project_tree", description: "Get a visual tree view of the entire project structure with line counts.", parameters: { type: "object", properties: { path: { type: "string", description: "Optional relative base path. NO leading slash." } }, required: [] } } },
  { type: "function", function: { name: "screenshot_preview", description: "Take a screenshot of the current web preview to see how the UI actually looks. Returns a visual image of the rendered page. Use this AFTER creating/editing files to verify the visual result and spot UI issues. Call with no arguments.", parameters: { type: "object", properties: {}, required: [] } } },
];

export interface WorkspaceContext {
  fileTree: string;
  projectType: string;
  dependencies: string;
}

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildToolDescriptions(): string {
  return `
Available file tools (call using <tool_call> tags):
1. **read_file** - Read file contents. Params: { "path": "file path", "startLine": number, "endLine": number }. Max 150 lines default.
2. **create_file** - Create a new file. Params: { "path": "file path", "content": "full file content" }. Parent dirs auto-created.
3. **edit_file** - Edit a file. Params: { "path": "file path", "search": "exact old text", "replace": "new text" } OR { "path": "file path", "newContent": "full new content" }.
4. **delete_file** - Delete a file. Params: { "path": "file path" }.
5. **list_files** - List directory. Params: { "path": "dir path" }.
6. **search_files** - Search files. Params: { "query": "search text", "searchContents": true/false, "path": "optional dir" }.`;
}

function buildSystemPrompt(ctx?: WorkspaceContext): string {
  const projectInfo = ctx
    ? `
## CURRENT PROJECT

**Stack:** ${ctx.projectType}
**Key dependencies:** ${ctx.dependencies}

**File tree:**
\`\`\`
${ctx.fileTree}
\`\`\`
`
    : "";

  return `You are PiPilot, a world-class AI software engineer and UI/UX designer built into a browser-based IDE with DIRECT file system access. You are extremely skilled at building complete, production-quality web applications from scratch. The IDE has a live web preview powered by Sandpack.

You think step-by-step, plan before you code, and build complete polished applications — never half-finished demos.
${projectInfo}
## STACK

The default stack is **HTML + CSS + JavaScript** with the **Tailwind CSS CDN** for styling.
- All projects start with \`index.html\`, \`styles.css\`, and \`app.js\`
- Use \`<script src="https://cdn.tailwindcss.com"></script>\` in the HTML head for Tailwind
- Use vanilla JavaScript — no frameworks, no build step, no npm
- The preview updates live as files are created/edited
- You can also build projects using **multiple JS files** organized by feature (e.g. \`router.js\`, \`api.js\`, \`components.js\`, \`utils.js\`)
- For data-heavy apps, create a separate \`data.js\` file with all content/data arrays

## ROUTING & MULTI-PAGE ARCHITECTURE (CRITICAL)

Build real, multi-page apps using **hash-based routing** — not single static pages.

### How hash routing works:
- Define routes as hash fragments: \`#/\`, \`#/about\`, \`#/product/{slug}\`
- Listen to \`hashchange\` event to render the correct page
- Use \`window.location.hash\` to read the current route
- Browser back/forward buttons work automatically

### Required routing pattern in app.js:
\`\`\`
// Route definitions
const routes = {
  '/': renderHomePage,
  '/about': renderAboutPage,
  '/contact': renderContactPage,
  '/product/:slug': renderProductDetail,  // dynamic route
};

function router() {
  const hash = window.location.hash.slice(1) || '/';
  // Match dynamic routes like /product/some-slug
  for (const [pattern, handler] of Object.entries(routes)) {
    if (pattern.includes(':')) {
      const regex = new RegExp('^' + pattern.replace(/:([^/]+)/g, '([^/]+)') + '$');
      const match = hash.match(regex);
      if (match) { handler(...match.slice(1)); return; }
    }
    if (hash === pattern) { handler(); return; }
  }
  render404();
}

window.addEventListener('hashchange', router);
router(); // initial render
\`\`\`

### Navigation links — ALWAYS use hash links:
- \`<a href="#/">\` for home
- \`<a href="#/about">\` for about
- \`<a href="#/product/modern-villa">\` for dynamic detail pages
- Add \`onclick="navigate('/product/modern-villa')")\` helper for programmatic navigation

### Dynamic detail pages:
When building apps with listings (products, properties, team members, etc.), ALWAYS create detail pages:
- Each item gets its own route: \`#/property/{slug}\`
- Detail page includes: image gallery, full description, features list, related items, back button
- Use a data array in JS and look up by slug to render the detail page
- Include "Back to Listings" link: \`<a href="#/">\`

### Reusable HTML components:
Create reusable render functions for repeated UI patterns:
- \`renderNavbar()\` — consistent nav across all pages
- \`renderFooter()\` — consistent footer across all pages
- \`renderCard(item)\` — reusable card component for listings
- \`renderHero(title, subtitle, bgImage)\` — reusable hero section
- Put shared data (nav links, footer info) in a \`data.js\` file

### Page transitions:
- Add \`fade-in\` CSS animation on page change
- Scroll to top on navigation: \`window.scrollTo(0, 0)\`

### Example structure for a real estate site:
- \`#/\` → Home with hero + featured listings grid
- \`#/listings\` → All properties with filters
- \`#/property/modern-hillside-villa\` → Full detail page with gallery, description, features, agent card
- \`#/about\` → About the agency + team members
- \`#/contact\` → Contact form

NEVER build a single-page static site. ALWAYS build multi-page apps with routing, dynamic detail pages, and reusable components.

## FILE TOOLS

You have powerful file management tools via native function calling. The user sees files update live in the editor and preview.

### ⚠️ PATH FORMAT (CRITICAL — READ THIS):
- All file paths are **relative** with **NO leading slash**.
- Correct: \`"path": "app.js"\`, \`"path": "src/utils.js"\`, \`"path": "styles.css"\`
- **WRONG**: \`"path": "/app.js"\`, \`"path": "/workspace/app.js"\`, \`"path": "./app.js"\`
- There is NO \`/workspace/\` prefix. There is NO root \`/\`. Just the bare filename or relative path.
- For list_files, use \`"path": ""\` or \`"path": "src"\` — never \`"/"\` or \`"/workspace"\`.
- Folders: \`"path": "src"\` NOT \`"path": "/src"\` or \`"path": "src/"\`.
- Examples:
  - Read a file: \`{ "path": "index.html" }\` ✅  NOT \`{ "path": "/index.html" }\` ❌
  - List root: \`{ "path": "" }\` ✅  NOT \`{ "path": "/" }\` ❌
  - Read nested: \`{ "path": "src/components/App.tsx" }\` ✅  NOT \`{ "path": "/src/components/App.tsx" }\` ❌

### Core Tools:
- **create_file** — Create a new file with full content. Parent dirs auto-created.
- **edit_file** — Edit a file via search/replace or full rewrite (newContent).
- **read_file** — Read file contents (up to 500 lines). Use startLine/endLine for ranges.
- **delete_file** — Delete a file or directory (recursive).
- **list_files** — List files and directories at a path (up to 200 items).
- **search_files** — Search files by name or content (up to 50 results).

### Power Tools:
- **batch_create_files** — Create multiple files in one call. Pass array of {path, content}. Use this when scaffolding a new project or creating multiple files at once — much faster than individual create_file calls.
- **rename_file** — Rename or move a file/folder. Params: {oldPath, newPath}.
- **copy_file** — Duplicate a file. Params: {srcPath, destPath}.
- **get_project_tree** — Visual tree view of entire project with line counts. Use at start of complex tasks to understand the codebase.
- **deploy_site** — Deploy the project to a live public URL. Call this after finishing the site. Returns the live URL.

### Vision Tool:
- **screenshot_preview** — Takes a screenshot of the current web preview and returns a visual image. You can SEE the actual rendered UI. Use this to:
  - Verify your work looks correct after creating/editing files
  - Spot visual bugs (misalignment, wrong colors, broken layouts, overflow issues)
  - Check responsive design and spacing
  - Compare the result against the user's request
  - Call with no arguments: just invoke screenshot_preview
  - **IMPORTANT**: Call this AFTER you finish creating/editing files, not before. The preview needs the files to exist first.
  - When you receive the screenshot, describe what you see and identify any issues.

### Efficiency Tips:
- Use **batch_create_files** when creating 2+ files — it's much faster.
- Use **get_project_tree** before making major changes to understand what exists.
- Use **search_files** with searchContents:true to find specific code patterns.
- Always **read_file** before editing — never guess at content.
- Use **screenshot_preview** after building UI to verify it looks right — you have eyes!

## DEPLOYMENT

After building a complete site, ALWAYS call **deploy_site** to publish it. Tell the user the live URL so they can share it. If the user asks to deploy, publish, or share their site, call deploy_site immediately.

## DESIGN SYSTEM RULES

Every project gets a **unique, distinctive design** — never generic.

### Typography
- Pick a distinctive Google Font pairing. Import via \`<link>\` in index.html.
- BANNED fonts: Inter, Roboto, Arial, Poppins. Use unique fonts like Playfair Display, Space Grotesk, DM Serif, Outfit, Sora, etc.
- Define as CSS variables: \`--font-display\` for headings, \`--font-body\` for text.

### Colors
- Choose a bold, unique color palette for each project. Define as CSS custom properties in :root.
- BANNED: purple gradients, floating blobs, rainbow accents.
- Every project needs: primary, primary-light, accent, surface, surface-alt, text, text-muted, border colors.
- If dark mode: every \`dark:bg-*\` needs matching \`dark:text-*\` on all children.

### Layout & Composition
- Mix layout patterns: bento grids, split hero (60/40), asymmetric columns, overlapping cards.
- Never just stack centered text blocks. Use creative spatial relationships.
- Hero section must be impactful: large typography, strong visual hierarchy.

### Mobile-First Responsive (mandatory)
- Nav: hamburger menu on mobile → horizontal nav on desktop.
- Grids: grid-cols-1 → md:grid-cols-2 → lg:grid-cols-3.
- Hero text: text-3xl → md:text-5xl lg:text-6xl.
- Spacing: px-4 py-12 mobile → px-8 py-24 desktop.
- Touch targets: min 44x44px. No horizontal overflow.
- Footer: stack vertically on mobile, grid on desktop.

### Motion & Animations
- Page load: staggered fadeInUp with animation-delay per element.
- Cards: hover:shadow-xl hover:-translate-y-2 transition-all duration-300.
- Buttons: active:scale-95 transition-transform.
- Define @keyframes in styles.css for custom animations.

### Icons
- **UI icons** (arrows, menus, etc.): Use Lucide via CDN: \`<script src="https://unpkg.com/lucide@latest"></script>\` then call \`lucide.createIcons()\` in JS.
- **Brand/social/tech icons** (LinkedIn, GitHub, Twitter, React, Python, etc.): Use Simple Icons via \`<img>\` tag:
  \`<img src="https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/{name}.svg" alt="{name}" class="w-5 h-5">\`
  Examples: \`linkedin.svg\`, \`github.svg\`, \`twitter.svg\`, \`instagram.svg\`, \`react.svg\`, \`python.svg\`, \`javascript.svg\`, \`figma.svg\`
  Note: Simple Icons SVGs are black by default. Use CSS \`filter: invert(1)\` for white icons on dark backgrounds, or \`filter: brightness(0) saturate(100%) ...\` for custom colors.
- NEVER use emojis as icons. Always use proper SVG icons from Lucide or Simple Icons.

### Images (CRITICAL — ALWAYS USE)
- **EVERY website/app MUST include real images.** Never leave image placeholders empty or use broken URLs.
- Use this API for ALL images: \`https://api.a0.dev/assets/image?text={description}&aspect={ratio}\`
- Only THREE aspect ratios are supported: \`16:9\` (landscape — hero, banner, cards), \`1:1\` (square — avatars, profiles, logos), and \`9:16\` (portrait — mobile, stories, tall images). NO other ratios work.
- Description MUST be specific and vivid: \`text=modern%20coffee%20shop%20interior%20warm%20lighting%20wooden%20tables\` NOT \`text=coffee\`
- URL-encode the text parameter (spaces → %20)
- Examples:
  - Hero: \`https://api.a0.dev/assets/image?text=aerial%20view%20luxury%20resort%20turquoise%20ocean%20palm%20trees&aspect=16:9\`
  - Team photo: \`https://api.a0.dev/assets/image?text=professional%20headshot%20smiling%20woman%20business%20attire&aspect=1:1\`
  - Product: \`https://api.a0.dev/assets/image?text=minimalist%20leather%20watch%20dark%20background%20studio%20lighting&aspect=16:9\`
- Add \`&seed=12345\` for consistent images (different seeds = different images)
- Use at MINIMUM: 1 hero image, 1 image per card/section, team/profile photos where relevant

### Content
- Use REAL, specific content: actual names, prices, dates, descriptions.
- NEVER use lorem ipsum or placeholder text.
- Build ALL pages and sections fully — never "coming soon" placeholders.

### Background & Texture
- Add depth with subtle gradients, grain overlays, or mesh patterns.
- Never use flat solid color backgrounds alone.

## ADVANCED ARCHITECTURE PATTERNS

### State Management:
For complex apps, use a simple pub/sub event system:
\`\`\`
// state.js — central state management
const state = { user: null, cart: [], theme: 'light' };
const listeners = new Map();
function subscribe(key, fn) { if (!listeners.has(key)) listeners.set(key, []); listeners.get(key).push(fn); }
function setState(key, value) { state[key] = value; (listeners.get(key) || []).forEach(fn => fn(value)); }
function getState(key) { return state[key]; }
\`\`\`

### Component Pattern:
For larger apps, organize code into component render functions:
\`\`\`
// Each component returns an HTML string and optionally attaches event listeners
function renderProductCard(product) {
  return \\\`<div class="card" data-id="\${product.id}">...</div>\\\`;
}
// After inserting HTML, attach listeners: document.querySelectorAll('[data-id]').forEach(...)
\`\`\`

### Data Layer:
Separate data from presentation. Create \`data.js\` with all content arrays, \`api.js\` for data fetching, and keep UI rendering in \`app.js\` or component-specific files.

### Local Storage Persistence:
Use localStorage for user preferences, cart state, form data, and app settings:
\`\`\`
const saved = JSON.parse(localStorage.getItem('appState') || '{}');
function persist(key, value) { const s = JSON.parse(localStorage.getItem('appState')||'{}'); s[key]=value; localStorage.setItem('appState', JSON.stringify(s)); }
\`\`\`

### Animation Library Pattern:
For scroll-triggered animations, use IntersectionObserver:
\`\`\`
const observer = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('animate-in'); observer.unobserve(e.target); } });
}, { threshold: 0.1 });
document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
\`\`\`

## MANDATORY RULES

1. **NEVER paste code in chat.** Always use create_file, edit_file, or batch_create_files. The user sees files update live.

2. **ALWAYS include images.** Every website must use \`https://api.a0.dev/assets/image?text={description}&aspect={ratio}\` for hero images, cards, profiles, etc. A website without images looks broken.

3. **Before editing, read first.** Use read_file to see exact content, then edit_file with search/replace. Never guess at file contents.

4. **For websites/apps:** Start with \`get_project_tree\` to understand existing state. Then create files: \`index.html\` (Tailwind CDN + Google Fonts + Lucide icons), \`styles.css\` (CSS variables, custom animations, textures), \`app.js\` (routing, interactivity, icon init). Use \`batch_create_files\` to scaffold all files at once.

5. **Keep chat text brief** (1-2 sentences). Let tool calls do the work. Show progress, not process.

6. **Build complete, polished, production-quality UIs.** Every project should look like a real product — never a tutorial demo or placeholder. Include micro-interactions, loading states, error handling, and responsive design.

7. **Use batch_create_files** when scaffolding new projects or creating multiple files — it's significantly faster.

8. **Think before coding.** For complex requests, plan the file structure and architecture first, then execute. Use get_project_tree to understand what exists.

9. **Error resilience.** Add try/catch blocks around data operations, graceful fallbacks for missing images, and user-friendly error messages.

10. **Accessibility.** Use semantic HTML (nav, main, section, article, footer), ARIA labels, proper heading hierarchy, alt text on images, and keyboard-navigable interfaces.

11. **Visual verification.** After building or significantly editing a UI, call **screenshot_preview** to see the actual rendered result. If something looks wrong, fix it immediately. Don't just assume your code is correct — verify visually.`;
}

// ─── Tag-Based Tool Call Parser ──────────────────────────────────────────────

interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
  raw: string;
}

/**
 * Parse <tool_call>...</tool_call> blocks from text.
 * Returns the tool calls found and the cleaned text (without tool_call blocks).
 */
function parseToolCallsFromText(text: string): { toolCalls: ParsedToolCall[]; cleanText: string } {
  const toolCalls: ParsedToolCall[] = [];
  const regex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.name && parsed.arguments) {
        toolCalls.push({
          name: parsed.name,
          arguments: parsed.arguments,
          raw: match[0],
        });
      }
    } catch {
      // Try lenient parse - handle common JSON issues
      try {
        const cleaned = match[1].trim()
          .replace(/,\s*}/g, "}") // trailing commas
          .replace(/,\s*]/g, "]");
        const parsed = JSON.parse(cleaned);
        if (parsed.name && parsed.arguments) {
          toolCalls.push({ name: parsed.name, arguments: parsed.arguments, raw: match[0] });
        }
      } catch {
        // skip unparseable tool calls
      }
    }
  }

  // Also try to catch unclosed tool_call (model forgot closing tag)
  const unclosedRegex = /<tool_call>([\s\S]*?)$/;
  const unclosedMatch = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").match(unclosedRegex);
  if (unclosedMatch) {
    try {
      const parsed = JSON.parse(unclosedMatch[1].trim());
      if (parsed.name && parsed.arguments) {
        toolCalls.push({ name: parsed.name, arguments: parsed.arguments, raw: unclosedMatch[0] });
      }
    } catch { /* skip */ }
  }

  // Remove tool_call blocks from text for display
  const cleanText = text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
    .replace(/<tool_call>[\s\S]*$/g, "")
    .trim();

  return { toolCalls, cleanText };
}

// ─── Stream Consumer ─────────────────────────────────────────────────────────

interface StreamResult {
  fullText: string;       // raw text including tool_call tags
  continuationState: unknown | null; // server continuation state for timeout resume
  cleanText: string;      // text with tool_call tags stripped
  parsedToolCalls: ParsedToolCall[];
  nativeToolCalls: { id: string; type: string; function: { name: string; arguments: string } }[];
  finishReason: string | null;
  builtinStatuses: BuiltinToolStatus[];
}

async function consumeStream(
  response: Response,
  onToken: (token: string) => void,
  onToolStatus: (status: BuiltinToolStatus) => void,
  signal: AbortSignal
): Promise<StreamResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let fullText = "";
  const nativeToolCalls: StreamResult["nativeToolCalls"] = [];
  let finishReason: string | null = null;
  const builtinStatuses: BuiltinToolStatus[] = [];
  let continuationState: unknown | null = null;
  let sseBuffer = "";

  // For smart display: buffer text near tool_call tags so we don't show them
  let displayBuffer = "";
  let insideToolCall = false;

  function flushDisplayBuffer() {
    if (displayBuffer && !insideToolCall) {
      onToken(displayBuffer);
      displayBuffer = "";
    }
  }

  while (true) {
    if (signal.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const chunk = JSON.parse(trimmed.slice(6));
        const delta = chunk?.choices?.[0]?.delta;
        const reason = chunk?.choices?.[0]?.finish_reason;

        if (reason) finishReason = reason;

        // Continuation state — server is about to timeout, sends state to resume
        if (delta?.continuation) {
          continuationState = delta.continuation;
        }

        // Text content — accumulate and selectively display
        if (delta?.content) {
          fullText += delta.content;
          displayBuffer += delta.content;

          // Check if we're entering a tool_call block
          if (displayBuffer.includes("<tool_call>")) {
            // Show text before the tag
            const beforeTag = displayBuffer.split("<tool_call>")[0];
            if (beforeTag) onToken(beforeTag);
            displayBuffer = "";
            insideToolCall = true;
          }

          // Check if tool_call block closed
          if (insideToolCall && fullText.includes("</tool_call>")) {
            // Check if there's text after the closing tag
            const afterLastClose = fullText.split("</tool_call>").pop() || "";
            if (!afterLastClose.includes("<tool_call>")) {
              insideToolCall = false;
              displayBuffer = afterLastClose.split("\n").pop() || "";
            }
          }

          // If not inside a tool call, flush buffer periodically
          if (!insideToolCall && displayBuffer.length > 0 && !displayBuffer.includes("<tool_c")) {
            onToken(displayBuffer);
            displayBuffer = "";
          }
        }

        // Built-in tool status events (server-side tools like web_search)
        if (delta?.custom_status) {
          const status: BuiltinToolStatus = {
            name: delta.custom_status.name,
            type: delta.custom_status.type,
            arguments: delta.custom_status.arguments,
          };
          builtinStatuses.push(status);
          onToolStatus(status);
        }

        // Native OpenAI tool call deltas (fallback support)
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (!nativeToolCalls[tc.index]) {
              nativeToolCalls[tc.index] = {
                id: tc.id || "",
                type: tc.type || "function",
                function: { name: tc.function?.name || "", arguments: "" },
              };
            }
            if (tc.id) nativeToolCalls[tc.index].id = tc.id;
            if (tc.function?.name) nativeToolCalls[tc.index].function.name = tc.function.name;
            if (tc.function?.arguments) nativeToolCalls[tc.index].function.arguments += tc.function.arguments;
          }
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  // Flush any remaining display buffer
  if (displayBuffer && !insideToolCall) {
    onToken(displayBuffer);
  }

  // Parse tool calls from the full text
  const { toolCalls: parsedToolCalls, cleanText } = parseToolCallsFromText(fullText);

  return {
    fullText,
    cleanText,
    continuationState,
    parsedToolCalls,
    nativeToolCalls: nativeToolCalls.filter(Boolean),
    finishReason,
    builtinStatuses,
  };
}

// ─── Checkpoint Manager Interface ────────────────────────────────────────────

export interface CheckpointManager {
  createCheckpoint: (label: string, messageId?: string) => Promise<void>;
  restoreToCheckpoint: (id: string) => Promise<void>;
  findCheckpointBeforeMessage: (messageId: string) => Promise<string | null>;
}

// ─── useChat Hook ────────────────────────────────────────────────────────────

export function useChat(
  toolExecutor?: ToolExecutor,
  workspaceContext?: WorkspaceContext,
  checkpointManager?: CheckpointManager,
  projectId?: string
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [mode, setMode] = useState<ChatMode>("agent");
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const contextRef = useRef<WorkspaceContext | undefined>(workspaceContext);
  const checkpointManagerRef = useRef<CheckpointManager | undefined>(checkpointManager);
  const projectIdRef = useRef(projectId);
  contextRef.current = workspaceContext;
  checkpointManagerRef.current = checkpointManager;
  projectIdRef.current = projectId;
  messagesRef.current = messages;

  // Load messages from IndexedDB on project change
  useEffect(() => {
    if (!projectId) return;
    const sessionId = `chat-${projectId}`;
    db.chatMessages
      .where("sessionId")
      .equals(sessionId)
      .sortBy("timestamp")
      .then((dbMsgs) => {
        const loaded: ChatMessage[] = dbMsgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          toolCalls: m.toolCalls ? JSON.parse(m.toolCalls) : undefined,
          builtinToolStatuses: m.builtinToolStatuses ? JSON.parse(m.builtinToolStatuses) : undefined,
          tool_call_id: m.tool_call_id,
        }));
        setMessages(loaded);
      })
      .catch(console.error);
  }, [projectId]);

  // Persist messages to IndexedDB whenever they change
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (!projectId || messages.length === 0) return;
    // Debounce saves to avoid thrashing during streaming
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const sessionId = `chat-${projectId}`;
      const nonStreamingMsgs = messages.filter((m) => !m.streaming);
      if (nonStreamingMsgs.length === 0) return;
      // Clear old messages for this session and write new ones
      db.chatMessages
        .where("sessionId")
        .equals(sessionId)
        .delete()
        .then(() =>
          db.chatMessages.bulkPut(
            nonStreamingMsgs.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              sessionId,
              timestamp: m.timestamp,
              toolCalls: m.toolCalls ? JSON.stringify(m.toolCalls) : undefined,
              builtinToolStatuses: m.builtinToolStatuses ? JSON.stringify(m.builtinToolStatuses) : undefined,
              tool_call_id: m.tool_call_id,
            }))
          )
        )
        .catch(console.error);
    }, 1000);
  }, [messages, projectId]);

  const sendMessage = useCallback(
    async (userContent: string, imageDataUrls?: string[]) => {
      if (!userContent.trim() || isStreaming) return;

      const userMsg: ChatMessage = {
        id: generateId(),
        role: "user",
        content: userContent,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Create a "before" checkpoint capturing file state BEFORE this message's AI actions
        if (checkpointManagerRef.current) {
          const beforeLabel = `Before: ${userContent.slice(0, 50)}${userContent.length > 50 ? "..." : ""}`;
          try {
            await checkpointManagerRef.current.createCheckpoint(beforeLabel, `before-${userMsg.id}`);
          } catch (e) {
            console.error("Failed to create before-checkpoint:", e);
          }
        }

        // Build conversation history
        const allMessages = [...messagesRef.current, userMsg];
        const conversationMessages = allMessages
          .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "tool")
          .map((m) => {
            const msg: Record<string, unknown> = { role: m.role, content: m.content };
            if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
            return msg;
          });

        // If images were attached, convert the last user message to vision format
        if (imageDataUrls && imageDataUrls.length > 0) {
          const lastMsg = conversationMessages[conversationMessages.length - 1];
          if (lastMsg && lastMsg.role === "user") {
            const contentArray: Record<string, unknown>[] = [
              { type: "text", text: lastMsg.content as string },
            ];
            for (const dataUrl of imageDataUrls) {
              contentArray.push({
                type: "image_url",
                image_url: { url: dataUrl, detail: "high" },
              });
            }
            lastMsg.content = contentArray;
          }
        }

        const apiMessages: Record<string, unknown>[] = [
          { role: "system", content: buildSystemPrompt(contextRef.current) },
          ...conversationMessages,
        ];

        await runChatLoop(apiMessages, controller);

        // After the chat loop completes, create a checkpoint tied to this user message
        if (checkpointManagerRef.current) {
          const label = `After: ${userContent.slice(0, 50)}${userContent.length > 50 ? "..." : ""}`;
          try {
            await checkpointManagerRef.current.createCheckpoint(label, userMsg.id);
          } catch (e) {
            console.error("Failed to create checkpoint after chat:", e);
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          setMessages((prev) => [
            ...prev,
            { id: generateId(), role: "assistant", content: `Error: ${errMsg}`, streaming: false, timestamp: new Date() },
          ]);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, mode, toolExecutor]
  );

  async function runChatLoop(
    apiMessages: Record<string, unknown>[],
    controller: AbortController
  ) {
    let loopCount = 0;
    const maxLoops = mode === "agent" ? 50 : 10;

    while (loopCount < maxLoops) {
      loopCount++;

      const assistantId = generateId();
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          streaming: true,
          timestamp: new Date(),
          toolCalls: [],
          builtinToolStatuses: [],
        },
      ]);

      // Direct Kilo mode: bypass A0 brain entirely, call Kilo directly.
      // Kilo handles tool calling natively — our file tools are sent as OpenAI
      // function calling tools. When Kilo calls a file tool, the server streams
      // it as tool_call deltas and the client executes it.
      const body: Record<string, unknown> = {
        messages: apiMessages,
        stream: true,
        max_tokens: 32768,
        temperature: 0.7,
        direct_kilo: true,
        max_steps: 100,
        tools: FILE_TOOLS,
      };

      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const result = await consumeStream(
        response,
        (token) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + token } : m
            )
          );
        },
        (status) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, builtinToolStatuses: [...(m.builtinToolStatuses || []), status] }
                : m
            )
          );
        },
        controller.signal
      );

      // Merge tool calls from both sources: tag-based (parsed from text) + native OpenAI format
      const allToolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [];

      // Tag-based tool calls from text stream
      for (const tc of result.parsedToolCalls) {
        if (LOCAL_TOOL_NAMES.has(tc.name)) {
          allToolCalls.push({ id: generateId(), name: tc.name, args: tc.arguments });
        }
      }

      // Native OpenAI tool calls (fallback)
      for (const tc of result.nativeToolCalls) {
        if (LOCAL_TOOL_NAMES.has(tc.function.name)) {
          let args: Record<string, unknown>;
          try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
          allToolCalls.push({ id: tc.id || generateId(), name: tc.function.name, args });
        }
      }

      // Update the assistant message with clean text and tool calls
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: result.cleanText,
                streaming: false,
                toolCalls: allToolCalls.map((tc) => ({
                  id: tc.id,
                  name: tc.name,
                  arguments: JSON.stringify(tc.args),
                  status: "pending" as const,
                })),
              }
            : m
        )
      );

      // Handle continuation — server timed out, resume with continuation state
      if (result.finishReason === "continuation" && result.continuationState) {
        // Re-request with the continuation state to resume where the server left off
        const contBody: Record<string, unknown> = {
          messages: apiMessages,
          stream: true,
          max_tokens: 32768,
          temperature: 0.7,
          direct_kilo: true,
          max_steps: 100,
          tools: FILE_TOOLS,
          _continuation: result.continuationState,
        };

        const contResponse = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(contBody),
          signal: controller.signal,
        });

        if (contResponse.ok) {
          // Consume the continuation stream into the same assistant message
          const contResult = await consumeStream(
            contResponse,
            (token) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + token } : m
                )
              );
            },
            (status) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, builtinToolStatuses: [...(m.builtinToolStatuses || []), status] }
                    : m
                )
              );
            },
            controller.signal
          );

          // Merge continuation results
          result.cleanText = (result.cleanText + " " + contResult.cleanText).trim();
          result.parsedToolCalls.push(...contResult.parsedToolCalls);
          result.nativeToolCalls.push(...contResult.nativeToolCalls);
          result.finishReason = contResult.finishReason;
          result.continuationState = contResult.continuationState;

          // Re-parse tool calls from merged text
          const mergedParsed = parseToolCallsFromText(result.fullText + contResult.fullText);
          allToolCalls.length = 0;
          for (const tc of mergedParsed.toolCalls) {
            if (LOCAL_TOOL_NAMES.has(tc.name)) {
              allToolCalls.push({ id: generateId(), name: tc.name, args: tc.arguments });
            }
          }
          for (const tc of contResult.nativeToolCalls) {
            if (LOCAL_TOOL_NAMES.has(tc.function.name)) {
              let args: Record<string, unknown>;
              try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
              allToolCalls.push({ id: tc.id || generateId(), name: tc.function.name, args });
            }
          }

          // Update the message with merged content
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: result.cleanText,
                    streaming: false,
                    toolCalls: allToolCalls.map((tc) => ({
                      id: tc.id,
                      name: tc.name,
                      arguments: JSON.stringify(tc.args),
                      status: "pending" as const,
                    })),
                  }
                : m
            )
          );

          // If there was another continuation, loop again
          if (result.finishReason === "continuation" && result.continuationState) {
            continue;
          }
        }
      }

      // Execute local tool calls if any
      if (allToolCalls.length > 0 && toolExecutor) {
        // Direct Kilo mode: always use native OpenAI tool role messages
        apiMessages.push({
          role: "assistant",
          content: result.cleanText || null,
          tool_calls: allToolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        });

        for (const tc of allToolCalls) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, toolCalls: m.toolCalls?.map((t) => t.id === tc.id ? { ...t, status: "running" as const } : t) }
                : m
            )
          );

          let toolResult: string;
          try {
            toolResult = await toolExecutor(tc.name, tc.args);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, toolCalls: m.toolCalls?.map((t) => t.id === tc.id ? { ...t, status: "done" as const, result: toolResult } : t) }
                  : m
              )
            );
          } catch (err) {
            toolResult = `Error: ${err instanceof Error ? err.message : "Tool execution failed"}`;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, toolCalls: m.toolCalls?.map((t) => t.id === tc.id ? { ...t, status: "error" as const, result: toolResult } : t) }
                  : m
              )
            );
          }

          // Tool result must be a string (OpenAI format requirement).
          // For screenshots, send text result + inject image as a user vision message.
          if (tc.name === "screenshot_preview" && toolResult.startsWith("data:image/")) {
            // Store the data URL on the tool result for UI display
            // but send a plain text summary to the API as the tool result
            apiMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "Screenshot captured successfully. The image has been attached below for your review. Analyze the visual layout, colors, spacing, typography, and overall design quality. Identify any issues.",
            });
            // Inject the image as a user message so the vision model can see it
            apiMessages.push({
              role: "user",
              content: [
                {
                  type: "text",
                  text: "[System: Screenshot of the current web preview is attached. Review the UI and respond with your analysis.]",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: toolResult,
                    detail: "low", // "low" = 512px, faster + cheaper
                  },
                },
              ],
            });
          } else {
            apiMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: toolResult,
            });
          }
        }

        continue;
      }

      // No tool calls — we're done
      break;
    }
  }

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    const pid = projectIdRef.current;
    if (pid) {
      db.chatMessages.where("sessionId").equals(`chat-${pid}`).delete().catch(console.error);
    }
  }, []);

  const deleteMessage = useCallback((messageId: string) => {
    // Only delete if the message exists in current (project-scoped) messages
    const exists = messagesRef.current.some((m) => m.id === messageId);
    if (!exists) return;
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    const pid = projectIdRef.current;
    if (pid) {
      // Delete from DB, scoped by session
      db.chatMessages.get(messageId).then((msg) => {
        if (msg && msg.sessionId === `chat-${pid}`) {
          db.chatMessages.delete(messageId).catch(console.error);
        }
      }).catch(console.error);
    }
  }, []);

  /**
   * Revert conversation to the state before a given user message was sent.
   * 1. Find the checkpoint created BEFORE that user message.
   * 2. Restore the file state from that checkpoint.
   * 3. Delete all messages after that point from both UI and DB.
   */
  const revertToMessage = useCallback(
    async (messageId: string) => {
      const mgr = checkpointManagerRef.current;
      if (!mgr) return;

      const currentMessages = messagesRef.current;
      const msgIndex = currentMessages.findIndex((m) => m.id === messageId);
      if (msgIndex === -1) return;

      // Find the checkpoint created before this user message
      const checkpointId = await mgr.findCheckpointBeforeMessage(messageId);

      if (checkpointId) {
        try {
          await mgr.restoreToCheckpoint(checkpointId);
        } catch (e) {
          console.error("Failed to restore checkpoint:", e);
          return;
        }
      }

      // Get the message content before removing
      const targetMsg = currentMessages[msgIndex];

      // Get IDs of messages to remove (everything from this point onward)
      const removedIds = currentMessages.slice(msgIndex).map((m) => m.id);

      // Remove from UI
      setMessages((prev) => prev.slice(0, msgIndex));

      // Remove from DB (scoped by project session)
      const pid = projectIdRef.current;
      if (pid && removedIds.length > 0) {
        db.chatMessages
          .where("sessionId")
          .equals(`chat-${pid}`)
          .and((m) => removedIds.includes(m.id))
          .delete()
          .catch(console.error);
      }

      // Return the user message content so the caller can prefill the input
      return targetMsg.content;
    },
    []
  );

  return {
    messages,
    isStreaming,
    mode,
    setMode,
    sendMessage,
    stopStreaming,
    clearMessages,
    deleteMessage,
    revertToMessage,
  };
}
