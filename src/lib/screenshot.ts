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
    const content = jsFile.content ?? "";
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

    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();

    // Wait for load + JS execution
    await new Promise<void>((resolve) => {
      iframe.onload = () => setTimeout(resolve, 500); // give JS time to run
      // Fallback timeout
      setTimeout(resolve, RENDER_TIMEOUT);
    });

    // Small extra delay for animations/transitions to settle
    await new Promise((r) => setTimeout(r, 300));

    // 5. Capture with html2canvas
    const canvas = await html2canvas(iframeDoc.body, {
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
      windowWidth: CAPTURE_WIDTH,
      windowHeight: CAPTURE_HEIGHT,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: "#ffffff",
      scale: 1, // 1x for speed, 2x for retina quality
    });

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
