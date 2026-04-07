import html2canvas from "html2canvas";
import { db } from "./db";

/**
 * Browser Interaction Engine for PiPilot IDE.
 *
 * Gives the AI "hands" to interact with the web preview like a human:
 *   - Click elements (by selector or coordinates)
 *   - Scroll the page
 *   - Type into input fields
 *   - Find interactive elements on the page
 *
 * Uses a persistent hidden same-origin iframe (same approach as screenshot.ts)
 * that stays alive between interactions so state (scroll position, form data,
 * navigation) is preserved across tool calls.
 *
 * After every interaction, captures a screenshot + DOM analysis so the AI
 * can see the result of its action.
 */

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;
const RENDER_TIMEOUT = 3000;

// ─── Persistent iframe management ───────────────────────────────────────────

let activeIframe: HTMLIFrameElement | null = null;
let activeProjectId: string | null = null;
let iframeLoadedAt: number = 0;

/** Destroy the current interaction iframe (if any). */
function destroyIframe() {
  if (activeIframe && activeIframe.parentNode) {
    activeIframe.parentNode.removeChild(activeIframe);
  }
  activeIframe = null;
  activeProjectId = null;
  iframeLoadedAt = 0;
}

/** Build self-contained HTML from project files (same logic as screenshot.ts). */
async function buildHtml(projectId?: string): Promise<string> {
  let files = await db.files.where("type").equals("file").toArray();
  if (projectId) {
    files = files.filter((f) => f.projectId === projectId);
  }

  const indexHtml = files.find((f) => f.name === "index.html");
  if (!indexHtml?.content) {
    throw new Error("No index.html found in project — nothing to render.");
  }

  const cssFiles = files.filter((f) => f.name.endsWith(".css"));
  const jsFiles = files.filter((f) => f.name.endsWith(".js") && f.name !== "index.html");

  let html = indexHtml.content;

  // Inline CSS
  for (const cssFile of cssFiles) {
    const name = cssFile.name;
    const content = cssFile.content ?? "";
    const linkPatterns = [
      new RegExp(`<link[^>]*href=["']/?${escapeRegex(name)}["'][^>]*/?>`, "gi"),
      new RegExp(`<link[^>]*href=["']/?${escapeRegex(cssFile.id)}["'][^>]*/?>`, "gi"),
    ];
    let replaced = false;
    for (const pattern of linkPatterns) {
      if (pattern.test(html)) {
        html = html.replace(pattern, `<style>/* ${name} */\n${content}\n</style>`);
        replaced = true;
        break;
      }
    }
    if (!replaced && content.trim()) {
      html = html.replace("</head>", `<style>/* ${name} */\n${content}\n</style>\n</head>`);
    }
  }

  // Inline JS
  for (const jsFile of jsFiles) {
    const name = jsFile.name;
    let content = jsFile.content ?? "";
    content = content.replace(/<\/script>/gi, "<\\/script>");
    const scriptPatterns = [
      new RegExp(`<script[^>]*src=["']/?${escapeRegex(name)}["'][^>]*>\\s*</script>`, "gi"),
      new RegExp(`<script[^>]*src=["']/?${escapeRegex(jsFile.id)}["'][^>]*>\\s*</script>`, "gi"),
    ];
    let replaced = false;
    for (const pattern of scriptPatterns) {
      if (pattern.test(html)) {
        html = html.replace(pattern, `<script>/* ${name} */\n${content}\n</script>`);
        replaced = true;
        break;
      }
    }
    if (!replaced && content.trim()) {
      html = html.replace("</body>", `<script>/* ${name} */\n${content}\n</script>\n</body>`);
    }
  }

  // Remove problematic CDN scripts
  html = html.replace(
    /<script[^>]*src=["']https?:\/\/[^"']*unpkg\.com\/lucide[^"']*["'][^>]*>[\s\S]*?<\/script>/gi,
    "<!-- lucide removed for interaction -->"
  );

  // Global error suppressor
  html = html.replace(
    "<head>",
    `<head><script>window.onerror=function(){return true};</script>`
  );

  return html;
}

/** Get or create the persistent interaction iframe. Reloads if project changed. */
async function getIframe(projectId?: string): Promise<HTMLIFrameElement> {
  // If project changed or iframe was destroyed, rebuild
  if (activeIframe && activeProjectId === (projectId ?? null)) {
    // Check iframe is still in DOM
    if (activeIframe.parentNode) {
      return activeIframe;
    }
  }

  // Destroy old one if exists
  destroyIframe();

  const html = await buildHtml(projectId);

  const iframe = document.createElement("iframe");
  iframe.style.cssText = `
    position: fixed;
    top: -9999px;
    left: -9999px;
    width: ${VIEWPORT_WIDTH}px;
    height: ${VIEWPORT_HEIGHT}px;
    border: none;
    visibility: hidden;
    pointer-events: none;
    z-index: -1;
  `;
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!iframeDoc) throw new Error("Cannot access iframe document");

  if (iframe.contentWindow) {
    iframe.contentWindow.onerror = () => true;
  }

  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();

  // Wait for load + JS execution
  await new Promise<void>((resolve) => {
    iframe.onload = () => setTimeout(resolve, 400);
    setTimeout(resolve, RENDER_TIMEOUT);
  });
  await new Promise((r) => setTimeout(r, 200));

  activeIframe = iframe;
  activeProjectId = projectId ?? null;
  iframeLoadedAt = Date.now();

  return iframe;
}

/**
 * Check if project files have been modified since the iframe was loaded.
 * If so, reload the iframe to pick up changes.
 */
async function ensureFreshIframe(projectId?: string): Promise<HTMLIFrameElement> {
  if (activeIframe && activeProjectId === (projectId ?? null) && iframeLoadedAt > 0) {
    // Check if any files were updated after the iframe was loaded
    const files = await db.files.where("projectId").equals(projectId ?? "").toArray();
    const latestUpdate = Math.max(...files.map((f) => f.updatedAt?.getTime?.() ?? 0));
    if (latestUpdate > iframeLoadedAt) {
      // Files changed — reload
      destroyIframe();
    }
  }
  return getIframe(projectId);
}

/** Force-reload the iframe (e.g., after file changes). */
export async function reloadInteractionFrame(projectId?: string): Promise<void> {
  destroyIframe();
  await getIframe(projectId);
}

// ─── Screenshot + DOM capture (reusable after each interaction) ─────────────

async function captureState(iframe: HTMLIFrameElement): Promise<{ dataUrl: string; layoutReport: string }> {
  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!iframeDoc) throw new Error("Cannot access iframe document");

  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(iframeDoc.body, {
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      windowWidth: VIEWPORT_WIDTH,
      windowHeight: VIEWPORT_HEIGHT,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: "#ffffff",
      scale: 1,
      ignoreElements: (el) => el.tagName === "SCRIPT" || el.tagName === "IFRAME",
    });
  } catch {
    canvas = document.createElement("canvas");
    canvas.width = VIEWPORT_WIDTH;
    canvas.height = VIEWPORT_HEIGHT;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    ctx.fillStyle = "#333";
    ctx.font = "16px sans-serif";
    ctx.fillText("Screenshot capture failed after interaction", 40, VIEWPORT_HEIGHT / 2);
  }

  const iframeWin = iframe.contentWindow ?? window;
  const layoutReport = analyzeDom(iframeDoc.body, iframeWin);
  const dataUrl = canvas.toDataURL("image/png", 0.85);
  return { dataUrl, layoutReport };
}

// ─── Interaction tools ──────────────────────────────────────────────────────

/**
 * Click an element in the preview.
 * Accepts either a CSS selector OR x,y coordinates.
 */
export async function previewClick(
  projectId: string | undefined,
  options: { selector?: string; x?: number; y?: number }
): Promise<{ dataUrl: string; report: string }> {
  const iframe = await ensureFreshIframe(projectId);
  const iframeDoc = iframe.contentDocument!;
  const win = iframe.contentWindow!;

  let targetEl: Element | null = null;
  let clickX: number;
  let clickY: number;

  if (options.selector) {
    targetEl = iframeDoc.querySelector(options.selector);
    if (!targetEl) {
      const state = await captureState(iframe);
      return {
        dataUrl: state.dataUrl,
        report: `ERROR: No element found matching selector "${options.selector}".\n\n${state.layoutReport}`,
      };
    }
    const rect = targetEl.getBoundingClientRect();
    clickX = rect.x + rect.width / 2;
    clickY = rect.y + rect.height / 2;
  } else if (options.x !== undefined && options.y !== undefined) {
    clickX = options.x;
    clickY = options.y;
    targetEl = iframeDoc.elementFromPoint(clickX, clickY);
  } else {
    throw new Error("preview_click requires either 'selector' or 'x'+'y' coordinates.");
  }

  // Dispatch mouse events (mousedown, mouseup, click) like a real user
  const eventOpts = { bubbles: true, cancelable: true, clientX: clickX, clientY: clickY, view: win };
  if (targetEl) {
    targetEl.dispatchEvent(new MouseEvent("mousedown", eventOpts));
    targetEl.dispatchEvent(new MouseEvent("mouseup", eventOpts));
    targetEl.dispatchEvent(new MouseEvent("click", eventOpts));

    // If it's a link with href, navigate within the iframe
    const anchor = targetEl.closest("a");
    if (anchor?.href) {
      const href = anchor.getAttribute("href");
      if (href && !href.startsWith("http") && !href.startsWith("//")) {
        // Handle hash navigation
        if (href.startsWith("#")) {
          const hashTarget = iframeDoc.querySelector(href);
          if (hashTarget) hashTarget.scrollIntoView({ behavior: "smooth" });
        }
      }
    }
  }

  // Wait for any animations/transitions triggered by the click
  await new Promise((r) => setTimeout(r, 300));

  const state = await captureState(iframe);
  const elDesc = targetEl
    ? `<${targetEl.tagName.toLowerCase()}${targetEl.id ? '#' + targetEl.id : ''}${targetEl.className ? '.' + String(targetEl.className).split(' ').join('.') : ''}>`
    : "no element";

  return {
    dataUrl: state.dataUrl,
    report: `Clicked ${elDesc} at (${Math.round(clickX)}, ${Math.round(clickY)}).\n\n${state.layoutReport}`,
  };
}

/**
 * Scroll the preview page.
 */
export async function previewScroll(
  projectId: string | undefined,
  options: { direction: "up" | "down" | "left" | "right"; amount?: number; selector?: string }
): Promise<{ dataUrl: string; report: string }> {
  const iframe = await ensureFreshIframe(projectId);
  const iframeDoc = iframe.contentDocument!;

  const pixels = options.amount ?? 400;
  const scrollTarget = options.selector
    ? iframeDoc.querySelector(options.selector) ?? iframeDoc.documentElement
    : iframeDoc.documentElement;

  const scrollOpts: Record<string, number> = {};
  switch (options.direction) {
    case "down":  scrollOpts.top = pixels; break;
    case "up":    scrollOpts.top = -pixels; break;
    case "right": scrollOpts.left = pixels; break;
    case "left":  scrollOpts.left = -pixels; break;
  }

  scrollTarget.scrollBy({ ...scrollOpts, behavior: "smooth" });

  // Wait for scroll animation to complete
  await new Promise((r) => setTimeout(r, 400));

  const state = await captureState(iframe);
  const scrollPos = `scrollTop=${Math.round(scrollTarget.scrollTop)}, scrollLeft=${Math.round(scrollTarget.scrollLeft)}`;

  return {
    dataUrl: state.dataUrl,
    report: `Scrolled ${options.direction} by ${pixels}px${options.selector ? ` on "${options.selector}"` : ""}. Current position: ${scrollPos}.\n\n${state.layoutReport}`,
  };
}

/**
 * Type text into an input/textarea element.
 */
export async function previewType(
  projectId: string | undefined,
  options: { selector: string; text: string; clear?: boolean; pressEnter?: boolean }
): Promise<{ dataUrl: string; report: string }> {
  const iframe = await ensureFreshIframe(projectId);
  const iframeDoc = iframe.contentDocument!;
  const win = iframe.contentWindow!;

  const el = iframeDoc.querySelector(options.selector);
  if (!el) {
    const state = await captureState(iframe);
    return {
      dataUrl: state.dataUrl,
      report: `ERROR: No element found matching selector "${options.selector}".\n\n${state.layoutReport}`,
    };
  }

  // Focus the element
  if (el instanceof HTMLElement) el.focus();

  // Clear existing value if requested
  if (options.clear && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Type each character (simulates real typing for frameworks that listen to keydown/keyup)
  for (const char of options.text) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true, view: win }));
    el.dispatchEvent(new KeyboardEvent("keypress", { key: char, bubbles: true, view: win }));

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value += char;
    } else if (el.getAttribute("contenteditable")) {
      el.textContent = (el.textContent ?? "") + char;
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true, view: win }));
  }

  el.dispatchEvent(new Event("change", { bubbles: true }));

  // Press Enter if requested (e.g., submit a form)
  if (options.pressEnter) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, view: win }));
    el.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", code: "Enter", bubbles: true, view: win }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true, view: win }));

    // Also try to submit the closest form
    const form = el.closest("form");
    if (form) {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
  }

  await new Promise((r) => setTimeout(r, 300));

  const state = await captureState(iframe);
  const currentValue = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
    ? el.value
    : el.textContent ?? "";

  return {
    dataUrl: state.dataUrl,
    report: `Typed "${options.text}" into "${options.selector}". Current value: "${currentValue.slice(0, 200)}"${options.pressEnter ? " (Enter pressed)" : ""}.\n\n${state.layoutReport}`,
  };
}

/**
 * Find all interactive/clickable elements on the page.
 * Returns structured info about buttons, links, inputs, etc.
 */
export async function previewFindElements(
  projectId: string | undefined,
  options?: { selector?: string; type?: "clickable" | "input" | "text" | "all" }
): Promise<{ dataUrl: string; report: string }> {
  const iframe = await ensureFreshIframe(projectId);
  const iframeDoc = iframe.contentDocument!;

  const filterType = options?.type ?? "all";

  let selectors: string;
  switch (filterType) {
    case "clickable":
      selectors = 'a, button, [onclick], [role="button"], [role="link"], [role="tab"], [role="menuitem"], details > summary, input[type="submit"], input[type="button"]';
      break;
    case "input":
      selectors = 'input, textarea, select, [contenteditable="true"]';
      break;
    case "text":
      selectors = "h1, h2, h3, h4, h5, h6, p, span, li, td, th, label, figcaption";
      break;
    default:
      selectors = 'a, button, input, textarea, select, [onclick], [role="button"], h1, h2, h3, h4, h5, h6, p, img, nav, form, [contenteditable="true"]';
  }

  // If a custom selector is provided, use it instead
  if (options?.selector) {
    selectors = options.selector;
  }

  const elements = iframeDoc.querySelectorAll(selectors);
  const results: string[] = [];
  let idx = 0;

  elements.forEach((el) => {
    const rect = el.getBoundingClientRect();
    // Skip invisible or off-screen elements
    if (rect.width === 0 || rect.height === 0) return;
    const style = iframe.contentWindow!.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;

    idx++;
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls = el.className && typeof el.className === "string"
      ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
      : "";
    const text = (el.textContent ?? "").trim().slice(0, 60);
    const type = (el as HTMLInputElement).type ? ` type="${(el as HTMLInputElement).type}"` : "";
    const href = el.tagName === "A" ? ` href="${el.getAttribute("href") ?? ""}"` : "";
    const placeholder = (el as HTMLInputElement).placeholder ? ` placeholder="${(el as HTMLInputElement).placeholder}"` : "";
    const value = (el as HTMLInputElement).value ? ` value="${(el as HTMLInputElement).value.slice(0, 40)}"` : "";

    // Build a usable CSS selector for this element
    let bestSelector = tag;
    if (el.id) bestSelector = `#${el.id}`;
    else if (el.className && typeof el.className === "string") bestSelector = `${tag}.${el.className.trim().split(/\s+/)[0]}`;

    results.push(
      `  [${idx}] <${tag}${id}${cls}${type}${href}${placeholder}${value}> at (${Math.round(rect.x)},${Math.round(rect.y)}) ${Math.round(rect.width)}x${Math.round(rect.height)} ${text ? `"${text}"` : ""}\n       selector: "${bestSelector}"`
    );

    // Cap at 50 elements to keep response manageable
    if (idx >= 50) return;
  });

  const state = await captureState(iframe);

  const header = `=== INTERACTIVE ELEMENTS (${filterType}) ===\nFound ${idx} elements:\n`;
  const elementList = results.join("\n");

  return {
    dataUrl: state.dataUrl,
    report: `${header}${elementList}\n\n${state.layoutReport}`,
  };
}

// ─── DOM Analyzer (same as screenshot.ts) ───────────────────────────────────

interface ElementInfo {
  tag: string;
  role?: string;
  text?: string;
  x: number; y: number; w: number; h: number;
  bg?: string; color?: string;
  fontSize?: string; fontWeight?: string; fontFamily?: string;
  src?: string; href?: string;
  display?: string;
  children: ElementInfo[];
}

function isVisible(el: Element, style: CSSStyleDeclaration): boolean {
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = el.getBoundingClientRect();
  return rect.width !== 0 || rect.height !== 0;
}

function rgbToHex(rgb: string): string {
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return rgb;
  const r = parseInt(match[1]), g = parseInt(match[2]), b = parseInt(match[3]);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function analyzeElement(el: Element, depth: number, win: Window): ElementInfo | null {
  if (depth > 8) return null;
  if (["SCRIPT", "STYLE", "LINK", "META"].includes(el.tagName)) return null;

  const style = win.getComputedStyle(el);
  if (!isVisible(el, style)) return null;

  const rect = el.getBoundingClientRect();
  const info: ElementInfo = {
    tag: el.tagName.toLowerCase(),
    x: Math.round(rect.x), y: Math.round(rect.y),
    w: Math.round(rect.width), h: Math.round(rect.height),
    children: [],
  };

  const role = el.getAttribute("role");
  if (role) info.role = role;

  const bg = rgbToHex(style.backgroundColor);
  if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "#000000" && bg !== "transparent") info.bg = bg;
  const color = rgbToHex(style.color);
  if (color) info.color = color;

  info.fontSize = style.fontSize;
  if (style.fontWeight !== "400" && style.fontWeight !== "normal") info.fontWeight = style.fontWeight;
  if (["h1", "h2", "h3", "h4", "h5", "h6", "button", "a"].includes(info.tag)) {
    info.fontFamily = style.fontFamily.split(",")[0].trim().replace(/['"]/g, "");
  }
  if (["flex", "grid", "inline-flex", "inline-grid"].includes(style.display)) {
    info.display = style.display;
  }

  const directText = Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent?.trim())
    .filter(Boolean)
    .join(" ");
  if (directText) info.text = directText.slice(0, 100);

  if (el.tagName === "IMG") info.src = ((el as HTMLImageElement).src ?? "").slice(0, 80);
  if (el.tagName === "A") info.href = (el as HTMLAnchorElement).getAttribute("href") || undefined;

  for (const child of Array.from(el.children)) {
    const c = analyzeElement(child, depth + 1, win);
    if (c) info.children.push(c);
  }

  return info;
}

function formatLayoutTree(info: ElementInfo, indent = 0): string {
  const pad = "  ".repeat(indent);
  let desc = `${pad}<${info.tag}`;
  if (info.role) desc += ` role="${info.role}"`;
  if (info.display) desc += ` display=${info.display}`;
  desc += `> [${info.x},${info.y} ${info.w}x${info.h}]`;
  if (info.bg) desc += ` bg:${info.bg}`;
  if (info.text) desc += ` "${info.text}"`;

  const parts = [desc];
  for (const child of info.children) {
    parts.push(formatLayoutTree(child, indent + 1));
  }
  return parts.join("\n");
}

function analyzeDom(body: HTMLElement, win: Window = window): string {
  const rootInfo = analyzeElement(body, 0, win);
  if (!rootInfo) return "Could not analyze DOM — page may be empty.";

  const lines: string[] = ["=== UI LAYOUT ANALYSIS ===", `Viewport: ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`, ""];

  const allElements: ElementInfo[] = [];
  function collect(info: ElementInfo) { allElements.push(info); info.children.forEach(collect); }
  collect(rootInfo);

  const images = allElements.filter((e) => e.tag === "img");
  const links = allElements.filter((e) => e.tag === "a");
  const headings = allElements.filter((e) => /^h[1-6]$/.test(e.tag));
  const buttons = allElements.filter((e) => e.tag === "button" || (e.tag === "a" && e.role === "button"));

  lines.push("--- SUMMARY ---");
  lines.push(`Total visible elements: ${allElements.length}`);
  lines.push(`Images: ${images.length}`);
  lines.push(`Links: ${links.length}`);
  lines.push(`Headings: ${headings.map((h) => `${h.tag}:"${h.text || ""}"`).join(", ") || "none"}`);
  lines.push(`Buttons: ${buttons.map((b) => `"${b.text || ""}"`).join(", ") || "none"}`);
  lines.push("");
  lines.push("--- LAYOUT TREE ---");
  lines.push(formatLayoutTree(rootInfo));

  const report = lines.join("\n");
  return report.length > 4000 ? report.slice(0, 3900) + "\n\n[Truncated]" : report;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Clean up on project switch or unmount. */
export function destroyInteractionFrame() {
  destroyIframe();
}
