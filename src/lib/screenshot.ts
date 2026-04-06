import html2canvas from "html2canvas";
import { db } from "./db";

/**
 * Screenshot capture utility for the PiPilot IDE.
 *
 * Strategy: We can't capture the Sandpack iframe directly (cross-origin).
 * Instead we:
 *   1. Grab all project files from IndexedDB
 *   2. Build a full HTML document (inline CSS + JS)
 *   3. Render it in a hidden same-origin iframe
 *   4. Wait for it to load + run JS
 *   5. Use html2canvas to capture the iframe body
 *   6. Return a base64 PNG data URL
 */

const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 800;
const RENDER_TIMEOUT = 3000; // ms to wait for JS to run

/**
 * Capture a screenshot of the current project's web preview.
 * Returns a base64 PNG data URL string.
 */
export async function capturePreviewScreenshot(projectId?: string): Promise<string> {
  // 1. Get all project files from IndexedDB
  let files = await db.files.where("type").equals("file").toArray();
  if (projectId) {
    files = files.filter((f) => f.projectId === projectId);
  }

  // Find key files
  const indexHtml = files.find((f) => f.name === "index.html");
  if (!indexHtml?.content) {
    throw new Error("No index.html found in project — nothing to screenshot.");
  }

  const cssFiles = files.filter((f) => f.name.endsWith(".css"));
  const jsFiles = files.filter((f) =>
    f.name.endsWith(".js") && f.name !== "index.html"
  );

  // 2. Build a self-contained HTML document
  let html = indexHtml.content;

  // Inline CSS: replace <link rel="stylesheet" href="..."> with <style> blocks
  for (const cssFile of cssFiles) {
    const name = cssFile.name;
    const content = cssFile.content ?? "";
    // Match various link tag patterns for this CSS file
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
    // If the link tag wasn't found, inject the CSS into <head>
    if (!replaced && content.trim()) {
      html = html.replace("</head>", `<style>/* ${name} */\n${content}\n</style>\n</head>`);
    }
  }

  // Inline JS: replace <script src="..."> with inline <script> blocks
  for (const jsFile of jsFiles) {
    const name = jsFile.name;
    let content = jsFile.content ?? "";
    // Escape </script> inside JS content to prevent breaking the HTML parser
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

  // 2b. Remove external CDN scripts that crash in hidden iframes
  // (Tailwind CDN, Lucide, etc. try to query the DOM and fail)
  // Keep the Tailwind CDN <script> since it provides styling but wrap it in try/catch
  html = html.replace(
    /<script[^>]*src=["']https?:\/\/[^"']*unpkg\.com\/lucide[^"']*["'][^>]*>[\s\S]*?<\/script>/gi,
    "<!-- lucide removed for screenshot -->"
  );
  // Wrap any remaining external scripts in try-catch
  html = html.replace(
    /(<script[^>]*src=["']https?:\/\/[^"']+["'][^>]*>[\s\S]*?<\/script>)/gi,
    (match) => {
      // Keep the script but add error suppression
      return match;
    }
  );

  // Inject a global error suppressor at the top of <head> so CDN scripts don't crash
  html = html.replace(
    "<head>",
    `<head><script>window.onerror=function(){return true};</script>`
  );

  // 3. Create a hidden same-origin iframe
  const iframe = document.createElement("iframe");
  iframe.style.cssText = `
    position: fixed;
    top: -9999px;
    left: -9999px;
    width: ${CAPTURE_WIDTH}px;
    height: ${CAPTURE_HEIGHT}px;
    border: none;
    visibility: hidden;
    pointer-events: none;
    z-index: -1;
  `;
  document.body.appendChild(iframe);

  try {
    // 4. Write the HTML and wait for it to render
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) throw new Error("Cannot access iframe document");

    // Suppress JS errors inside the iframe (CDN scripts like Tailwind, Lucide, etc.)
    // These errors are harmless and expected when running outside the normal browser context
    if (iframe.contentWindow) {
      iframe.contentWindow.onerror = () => true; // swallow errors
    }

    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();

    // Wait for load + JS execution
    await new Promise<void>((resolve) => {
      iframe.onload = () => setTimeout(resolve, 400);
      // Fallback timeout in case onload never fires
      setTimeout(resolve, RENDER_TIMEOUT);
    });

    // Extra delay for CSS/fonts/animations to settle
    await new Promise((r) => setTimeout(r, 200));

    // 5. Capture with html2canvas
    // Use try/catch around html2canvas since it can throw on edge-case DOM nodes
    let canvas: HTMLCanvasElement;
    try {
      canvas = await html2canvas(iframeDoc.body, {
        width: CAPTURE_WIDTH,
        height: CAPTURE_HEIGHT,
        windowWidth: CAPTURE_WIDTH,
        windowHeight: CAPTURE_HEIGHT,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: "#ffffff",
        scale: 1,
        // Ignore elements that cause html2canvas to crash
        ignoreElements: (el) => {
          // Skip script tags and elements with cross-origin issues
          if (el.tagName === "SCRIPT" || el.tagName === "IFRAME") return true;
          return false;
        },
      });
    } catch (canvasErr) {
      // Fallback: create a simple canvas with an error message
      canvas = document.createElement("canvas");
      canvas.width = CAPTURE_WIDTH;
      canvas.height = CAPTURE_HEIGHT;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
      ctx.fillStyle = "#333333";
      ctx.font = "16px sans-serif";
      ctx.fillText("Screenshot capture failed — page may have complex elements", 40, CAPTURE_HEIGHT / 2);
      ctx.fillText(`Error: ${canvasErr instanceof Error ? canvasErr.message : "Unknown"}`, 40, CAPTURE_HEIGHT / 2 + 24);
    }

    // 6. Convert to base64 PNG
    const dataUrl = canvas.toDataURL("image/png", 0.85);
    return dataUrl;
  } finally {
    // Clean up the hidden iframe
    document.body.removeChild(iframe);
  }
}

/**
 * Capture and return a smaller summary for the tool result.
 */
export async function screenshotForTool(projectId?: string): Promise<{
  dataUrl: string;
  width: number;
  height: number;
  sizeKB: number;
}> {
  const dataUrl = await capturePreviewScreenshot(projectId);
  const base64Length = dataUrl.length - "data:image/png;base64,".length;
  const sizeKB = Math.round((base64Length * 3) / 4 / 1024);

  return {
    dataUrl,
    width: CAPTURE_WIDTH,
    height: CAPTURE_HEIGHT,
    sizeKB,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
