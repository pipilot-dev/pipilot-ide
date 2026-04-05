# Design System for "AI Chat Agent Interface"

## Aesthetic Direction
Dark, professional developer tool aesthetic: compact, high-density UI with crisp edges, monospaced headings, subtle technical textures, clear distinctions between streaming chat and discrete tool actions. Prioritizes legibility in long sessions, fast keyboard navigation, and visible execution state for file operations.

## Typography
- **Display font**: IBM Plex Mono (Google Font) - used for headings and code-like labels (headings, hero text)
- **Body font**: Source Sans 3 (Google Font) - used for body, UI labels and microcopy (paragraphs, UI text)
- Import via Google Fonts `<link>` tag in index.html
- CSS variables: `--font-display: 'IBM Plex Mono (Google Font) - used for headings and code-like labels', serif;` and `--font-body: 'Source Sans 3 (Google Font) - used for body, UI labels and microcopy', sans-serif;`

## Color Palette
- Primary: #0F6F74 | Primary Light: #18999E | Accent: #FFB86B
- Surface: #0B0F13 | Surface Alt: #0F1418
- Text: #E6EEF2 | Text Muted: #99A4AA | Border: #16343A
- Dark mode surface: #050607 | Dark mode text: #CFE6EA

## CSS Variables (paste into index.css)
:root { --font-display: 'IBM Plex Mono (Google Font) - used for headings and code-like labels', serif; --font-body: 'Source Sans 3 (Google Font) - used for body, UI labels and microcopy', sans-serif; --color-primary: #0F6F74; --color-primary-light: #18999E; --color-accent: #FFB86B; --color-surface: #0B0F13; --color-surface-alt: #0F1418; --color-text: #E6EEF2; --color-text-muted: #99A4AA; --color-border: #16343A; }

## Layout Strategy
1. Left sidebar file tree + central chat + right file editor
2. Full-width chat with collapsible file drawer and bottom tool console
3. Split view: file browser (left) + editor (center) + streaming assistant pane (right)

## Hero Section
Compact developer hero: 220px tall, left-aligned miniature file tree preview, center title and short flowline describing capabilities, right-side CTA. Background uses a low-contrast technical grid + subtle noise; foreground includes a thin toolbar with execution indicator and recent tool-history chips.

## Motion & Animations
- streaming typewriter for assistant responses
- subtle shimmer/progress bar for tool execution
- Page load: staggered fadeInUp with animation-delay per element
- Cards: hover:shadow-xl hover:-translate-y-2 transition-all duration-300
- Buttons: active:scale-95 transition-transform

## Background & Texture
Subtle film-grain + low-contrast diagonal grid; occasional faint code lines as background motif (no blobs, no gradients)

## Unique Memorable Element
Inline operation chips (terminal-styled badges) that attach to chat messages and animate a short terminal-like output slide when a tool runs—acts as a persistent mini-log for that message.

## Icons
Use Lucide React icons consistently (20px, stroke-width 1.5). NEVER use emojis as icons.

## Mobile-First Responsive (mandatory)
- Nav: hamburger menu on mobile → horizontal nav on desktop
- Grids: grid-cols-1 → md:grid-cols-2 → lg:grid-cols-3
- Hero text: text-3xl → md:text-5xl lg:text-6xl
- Spacing: px-4 py-12 mobile → px-8 py-24 desktop
- Touch targets: min 44x44px. No horizontal overflow.
- Footer: stack vertically on mobile, grid on desktop

## Sample Copy
- **Hero heading**: "AI Chat Agent — File-aware, Dev-grade Assistant"
- **Hero subtext**: "Read, list, edit, create and delete workspace files with tool-backed actions; streaming responses and visible execution state integrated into a developer-focused interface."
- **CTA button**: "Open Workspace"
- **Section headings**: "Chat Workspace", "File Manager", "Execution & Tool Log"

## Reminders
- Images: https://api.a0.dev/assets/image?text={description}&aspect=16:9
- Real content: specific names, prices, dates — never lorem ipsum
- Every dark:bg-* needs matching dark:text-* on all children
- Build ALL pages fully — never "coming soon" placeholders

Apply this design system to every file you create.