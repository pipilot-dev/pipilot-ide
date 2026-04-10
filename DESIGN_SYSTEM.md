# PiPilot IDE — Design System

> **"Editorial Terminal"** — a magazine-spread aesthetic for a developer tool.
> Dark canvas, electric-lime accent used sparingly, typographic contrast between
> italic display serif and tracked-out mono labels.

This is the source of truth. Before building or modifying any UI in this project,
skim this file. Tokens live at `src/lib/design-tokens.ts`.

---

## 1. Philosophy

- **Editorial, not corporate.** The IDE should feel like opening a printed journal,
  not a dashboard template. Magazine layouts, numbered indexes, printed rules,
  generous negative space at section boundaries.
- **Restraint with the accent.** Lime is the punctuation, never the paragraph.
  One accent per viewport is usually enough.
- **Two fonts doing different jobs.** Instrument Serif carries emotion and
  hierarchy. JetBrains Mono does the technical work (labels, indexes, timestamps,
  code). Inter Tight is the neutral body — never hero.
- **Motion is reserved for high-impact moments.** Page-load fade + stagger,
  slide-on-hover for interactive rows. No spinning icons, no bouncing UI.

---

## 2. Color tokens (`src/lib/design-tokens.ts`)

```ts
export const COLORS = {
  // Surfaces
  bg:          "#0b0b0e",  // page background (editor, welcome, activity bar)
  surface:     "#15151b",  // panels (sidebar, chat, modals)
  surfaceAlt:  "#101015",  // sub-surfaces (inputs, hover wells)
  border:      "#28282f",  // hairline dividers
  borderHover: "#3d3d46",  // hovered border

  // Text
  text:        "#f5f5f7",  // primary
  textMid:     "#a8a8b3",  // secondary
  textDim:     "#5e5e68",  // tertiary (labels, section kickers)
  textFaint:   "#3a3a42",  // separators, disabled

  // Accents — use SPARINGLY
  accent:      "#c6ff3d",  // electric lime
  accentDim:   "#c6ff3d22",
  accentLine:  "#c6ff3d55",

  // Semantic
  warn:  "#ffb86b",
  error: "#ff6b6b",
  ok:    "#a8ff7a",
  info:  "#7ad6ff",
};
```

**Accent usage rules:**
- ✅ Section kickers (`/ A`, `/ B`, `/ C`)
- ✅ The period after a display heading ("build**.**")
- ✅ A single italic word inside a display heading ("what shall we *build*")
- ✅ Active indicators: activity bar left bar, active tab top strip, focused input ring, indicator dot
- ✅ Hover states on interactive rows (numbered lists, recent projects)
- ❌ Bulk text, paragraph bodies
- ❌ Multiple primary buttons in the same viewport
- ❌ Background fills (use `accentDim` at 0x22 alpha only for subtle chips)

---

## 3. Typography

```ts
export const FONTS = {
  display: `"Instrument Serif", "Fraunces", Georgia, serif`,
  mono:    `"JetBrains Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace`,
  sans:    `"Inter Tight", -apple-system, BlinkMacSystemFont, system-ui, sans-serif`,
};
```

Loaded on demand from Google Fonts by calling `injectFonts()` from any panel
that uses them. Idempotent — safe to call multiple times per mount.

### Type scale

| Use | Font | Size | Weight | Letter-spacing | Line-height |
|---|---|---|---|---|---|
| Hero display (welcome) | display | `clamp(54px, 7vw, 96px)` | 400 | `-0.025em` | 0.95 |
| Section display heading | display | 32-38px | 400 | `-0.02em` | 1.05 |
| Item title (action row) | display | 24-28px | 400 | `-0.01em` | 1.05 |
| Project name (list) | display | 22px | 400 | `0` | 1.1 |
| Body | sans | 12-14px | 400 | `0` | 1.6 |
| Body small | sans | 11-12px | 400 | `0` | 1.5 |
| Section label | mono | 9-10px | 500 | `0.18em` | 1 — UPPERCASE |
| Index `/ A` | mono | 9-10px | 500 | `0.18em` | 1 — UPPERCASE — color: accent |
| Timestamp | mono | 10-11px | 400 | `0.05em` | 1 — lowercase |
| Kbd chip | mono | 9-10px | 400 | `0` | 1 |
| Tag / badge | mono | 8-9px | 500 | `0.1em` | 1 — UPPERCASE |

**Italic rules:** only display font uses italic, and only for one emphasized word
per heading (never whole sentences).

---

## 4. Layout primitives

### 4.1 Section label (the universal header)

Every panel starts with this pattern:

```tsx
<div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 14px 10px" }}>
  <span style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
                 letterSpacing: "0.18em", textTransform: "uppercase",
                 color: COLORS.accent }}>
    / A
  </span>
  <span style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 500,
                 letterSpacing: "0.18em", textTransform: "uppercase",
                 color: COLORS.text }}>
    Explorer
  </span>
  {/* optional count or badge */}
</div>
<div style={{ height: 1, background: COLORS.border, margin: "0 14px" }} />
```

The `/ X` index is assigned to the panel in its contextual alphabet:
- `/ A` — Explorer
- `/ B` — Search
- `/ C` — AI Assistant
- `/ 04` — Clone modal (numbered for steps/actions)

### 4.2 Numbered action row

Used in Welcome page actions, chat empty-state prompts, and any "pick one of
these things" list. Hover slides the row right and turns the accent on.

```tsx
<li>
  <button style={{
    width: "100%",
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    gap: 24,
    padding: "20px 0",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid ${COLORS.border}",
    textAlign: "left",
    transition: "padding 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
  }}>
    <span data-num style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.textDim }}>
      01
    </span>
    <div>
      <div data-label style={{ fontFamily: FONTS.display, fontSize: 28, color: COLORS.text }}>
        Item label
      </div>
      <div style={{ fontFamily: FONTS.sans, fontSize: 13, color: COLORS.textMid }}>
        Description in body sans
      </div>
    </div>
    <span data-arrow>→</span>
  </button>
</li>
```

**Hover behavior:**
- `paddingLeft: 12px` (slide right)
- `data-num` → `color: COLORS.accent`
- `data-label` → `color: COLORS.accent`
- `data-arrow` → `opacity: 1`, `transform: translate(0, 0)`, `color: COLORS.accent`

### 4.3 Atmospheric background (hero panels only)

Welcome pages and hero empty states layer three effects:

1. **Radial glow** in top-right or top-left corner (`${accent}10` → transparent,
   blurred 20px, 720x720)
2. **Dot grid** via radial-gradient backgroundImage at `32px 32px` tile with a
   radial mask so it fades off-canvas
3. **SVG feTurbulence noise grain** at opacity 0.04, mix-blend overlay

Never use all three on dense panels — they're for calm canvases.

---

## 5. Components vocabulary

### 5.1 Buttons

- **Primary (`accent`)** — Used for the ONE final action in a modal. `background:
  COLORS.accent`, `color: COLORS.bg` (dark text on lime), mono uppercase label,
  4px radius. Example: "Clone →" button.
- **Secondary (`surface border`)** — Cancel, ghost actions. `background:
  transparent`, `border: 1px solid COLORS.border`, `color: COLORS.textMid`,
  mono uppercase label.
- **Icon button** — 22x22, transparent background, `color: COLORS.textDim`.
  Hover turns `color: COLORS.accent` and `border-color: COLORS.borderHover`.

### 5.2 Inputs

- Background: `COLORS.surfaceAlt` (`#101015`)
- Border: `1px solid COLORS.border`
- Text: `COLORS.text`, `fontFamily: FONTS.mono` (for technical inputs like paths,
  URLs, filters) or `FONTS.sans` (for natural-language chat)
- Placeholder: lowercase, color `COLORS.textDim`
- Radius: 4-6px
- Focus ring: **no Tailwind focus ring**. Instead, border shifts to
  `COLORS.borderHover` or `COLORS.accentLine`

### 5.3 Tags / badges

- Font: mono uppercase, 8-9px, letter-spacing 0.1em
- Background: `COLORS.surfaceAlt` or `accentDim` for accent variants
- Border: `1px solid COLORS.border` or `accentLine`
- Radius: 2px (NOT pill)
- Padding: `1px 5px`
- **Tool pills and semantic chips all follow this shape.**

### 5.4 Indicator dots

- `width: 6px; height: 6px; border-radius: 50%`
- Background: `COLORS.accent` for "online/active"
- `boxShadow: 0 0 8px ${COLORS.accent}80` for the soft glow
- Used in chat header, activity bar, section kickers

### 5.5 Kbd chips

```tsx
<kbd style={{
  padding: "1px 6px",
  fontFamily: FONTS.mono,
  fontSize: 9-10,
  background: COLORS.surface,
  color: COLORS.text,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 3,
}}>Ctrl P</kbd>
```

### 5.6 Message bubbles

- **User** → solid `COLORS.surface` background, rounded, tail-radius adjustment
  on top right, no accent. Mono for @mentions.
- **Assistant** → **TRANSPARENT background**, no bubble border, just avatar +
  content floating on the panel surface. Text color is `COLORS.text`.
- **Tool call pill** → `background: COLORS.surfaceAlt`, `1px solid COLORS.border`,
  radius 4px, padding `4px 8px`, mono label.

---

## 6. Motion

Use these easings:
- **Content reveal:** `cubic-bezier(0.16, 1, 0.3, 1)` (fast-out, slow-in)
- **Hover:** `0.15-0.18s` duration, linear or `ease`

Patterns:
- **Page load:** staggered fade+translateY(12px→0) with 0ms / 100ms / 200ms
  delays on three major sections (hero, body, footer)
- **Row hover:** `padding-left: 0 → 12px` slide over 200ms
- **Active indicators:** fade in the lime bar/strip over 150ms

Never use: bouncing, rotating, scaling-up-large, Tailwind's default transitions,
gradient animations.

---

## 7. What to AVOID

- ❌ Inter as the primary font (use Inter Tight, sparingly, only for body)
- ❌ Purple gradients on dark backgrounds
- ❌ Multiple accent colors in one viewport
- ❌ Full-width buttons with gradient fills
- ❌ Symmetric card grids as the default layout
- ❌ `rounded-xl` / `rounded-2xl` everywhere — prefer 3-6px radius
- ❌ Hover backgrounds that flash (use color/border-color transitions instead)
- ❌ Default Tailwind colors like `text-blue-500`, `bg-zinc-800` — use tokens
- ❌ Three-level-nested dropdowns and popovers — this isn't Salesforce
- ❌ Verbose tooltips that repeat the button label

---

## 8. Files that follow this system

| Component | File |
|---|---|
| Welcome page | `src/components/ide/WelcomePage.tsx` |
| Activity bar | `src/components/ide/ActivityBar.tsx` |
| Sidebar panel (explorer/search headers) | `src/components/ide/SidebarPanel.tsx` |
| Chat panel | `src/components/chat/ChatPanel.tsx` |
| Chat message rendering | `src/components/chat/ChatMessage.tsx` |
| Folder picker modal | `src/components/ide/FolderPicker.tsx` |
| Editor chrome (tabs/status/breadcrumb) | `src/index.css` |
| Shared tokens | `src/lib/design-tokens.ts` |

When adding a new UI component:
1. Import tokens from `@/lib/design-tokens`
2. Call `injectFonts()` in a `useEffect(() => { injectFonts(); }, [])`
3. Start with a section label using `/ X` vocabulary
4. Use display for emphasis (one italic accent word + lime period), mono for
   technical labels, sans for body
5. Keep accent usage to ONE spot per viewport
6. Read this file again before committing if you changed more than ~50 lines of
   visual code.
