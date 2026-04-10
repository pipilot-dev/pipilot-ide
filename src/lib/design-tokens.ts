/**
 * Shared design tokens for the PiPilot IDE — "Editorial Terminal" aesthetic.
 * Used by WelcomePage, SidebarPanel, ChatPanel, ActivityBar to maintain
 * a consistent visual language.
 *
 * Direction: dark canvas, sparse electric-lime accent, typographic contrast
 * between Instrument Serif (display, italic) and JetBrains Mono (technical
 * labels). Inter Tight for body sans.
 */

export const COLORS = {
  // Surfaces
  bg: "#0b0b0e",          // page background
  surface: "#15151b",     // panels (sidebar, chat)
  surfaceAlt: "#101015",  // sub-surfaces (input bg, hover)
  border: "#28282f",      // hairline dividers
  borderHover: "#3d3d46", // hovered border

  // Text
  text: "#f5f5f7",        // primary
  textMid: "#a8a8b3",     // secondary
  textDim: "#5e5e68",     // tertiary
  textFaint: "#3a3a42",   // separators

  // Accents
  accent: "#c6ff3d",         // electric lime — used SPARINGLY
  accentDim: "#c6ff3d22",    // accent at low alpha for backgrounds
  accentLine: "#c6ff3d55",   // accent at mid alpha for borders

  // Semantic
  warn: "#ffb86b",
  error: "#ff6b6b",
  ok: "#a8ff7a",
  info: "#7ad6ff",
} as const;

export const FONTS = {
  display: `"Instrument Serif", "Fraunces", Georgia, serif`,
  mono: `"JetBrains Mono", "Cascadia Code", "Fira Code", ui-monospace, monospace`,
  sans: `"Inter Tight", -apple-system, BlinkMacSystemFont, system-ui, sans-serif`,
} as const;

/**
 * Section label common styles — "tracked-out caps in mono" for divider headers
 * like EXPLORER, SEARCH, AI ASSISTANT.
 */
export const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontFamily: FONTS.mono,
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: COLORS.textDim,
};

/**
 * Inject Google Fonts once on first call. Idempotent.
 * Call from any component that uses display/mono/sans fonts.
 */
let fontsInjected = false;
export function injectFonts() {
  if (fontsInjected || typeof document === "undefined") return;
  fontsInjected = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@300;400;500&family=Inter+Tight:wght@400;500;600&display=swap";
  document.head.appendChild(link);
}
