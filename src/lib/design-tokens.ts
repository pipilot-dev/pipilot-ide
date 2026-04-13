/**
 * Shared design tokens for the PiPilot IDE.
 *
 * Direction: "Midnight Studio" — a refined dark workspace that feels
 * premium without being harsh. Warm neutral surfaces (not blue-tinted,
 * not pure black), a distinctive amber/gold accent for warmth and focus,
 * and carefully chosen typography that's readable for 12-hour sessions.
 *
 * Fonts: DM Sans (clean geometric sans, NOT Inter/Roboto/Arial) for UI,
 * Geist Mono (sharp, modern monospace from Vercel) for code.
 */

export const COLORS = {
  // Surfaces — warm dark neutrals, enough lift to see panel boundaries
  bg: "#16161a",          // page background — near-black with warmth
  surface: "#1c1c21",     // panels (sidebar, chat, modals)
  surfaceAlt: "#232329",  // sub-surfaces (input bg, hover wells, cards)
  border: "#2e2e35",      // hairline dividers — visible without glaring
  borderHover: "#44444d", // hovered/focused border

  // Text — soft contrast, matches editor brightness
  text: "#b0b0b8",        // primary — muted, easy on the eyes
  textMid: "#8a8a94",     // secondary
  textDim: "#6b6b76",     // tertiary (labels, timestamps)
  textFaint: "#42424a",   // separators, disabled

  // Accent — PiPilot orange palette
  accent: "#FF6B35",         // primary orange
  accentHover: "#FF5722",    // hover state
  accentLight: "#FF8C61",    // light variant (highlights, badges)
  accentDark: "#E64A19",     // dark variant (pressed, borders)
  accentDim: "#FF6B3520",    // accent at low alpha for chip backgrounds
  accentLine: "#FF6B3550",   // accent at mid alpha for focus rings

  // Semantic — soft, not oversaturated
  warn: "#e5a639",       // amber — distinct from accent orange
  error: "#e5534b",      // soft red — clear but not alarming
  ok: "#56d364",         // natural green
  info: "#6cb6ff",       // calm blue
} as const;

export const FONTS = {
  display: `"DM Sans", "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif`,
  mono: `"Geist Mono", "Cascadia Code", "Fira Code", "JetBrains Mono", ui-monospace, monospace`,
  sans: `"DM Sans", "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif`,
} as const;

/**
 * Section label common styles
 */
export const SECTION_LABEL_STYLE: React.CSSProperties = {
  fontFamily: FONTS.sans,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: COLORS.textDim,
};

/**
 * Inject fonts once on first call. Idempotent.
 * DM Sans — clean geometric sans from Google Fonts (NOT Inter)
 * Geist Mono — loaded from CDN (Vercel's monospace, sharp & modern)
 */
let fontsInjected = false;
export function injectFonts() {
  if (fontsInjected || typeof document === "undefined") return;
  fontsInjected = true;

  // DM Sans from Google Fonts
  const dmSans = document.createElement("link");
  dmSans.rel = "stylesheet";
  dmSans.href = "https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap";
  document.head.appendChild(dmSans);

  // Geist Mono from CDN
  const geist = document.createElement("link");
  geist.rel = "stylesheet";
  geist.href = "https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-mono/style.min.css";
  document.head.appendChild(geist);
}
