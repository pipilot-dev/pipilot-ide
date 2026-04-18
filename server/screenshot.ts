/**
 * screenshot.ts — Lightweight screenshot capture using puppeteer-core + system Chrome.
 *
 * Uses puppeteer-core (~3MB) with your already-installed Chrome/Chromium/Edge.
 * No bundled Chromium download. Keeps a persistent browser instance so
 * first screenshot is ~3-5s, subsequent ones are <2s.
 *
 * Auto-detects Chrome/Chromium/Edge/Brave on Windows, macOS, and Linux.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import puppeteer, { type Browser } from "puppeteer-core";

// ── Chrome/Chromium/Edge discovery ───────────────────────────────────────────

const KNOWN_PATHS: Record<string, string[]> = {
  win32: [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
    "C:/Program Files/Chromium/Application/chrome.exe",
    path.join(os.homedir(), "AppData/Local/Google/Chrome/Application/chrome.exe"),
    path.join(os.homedir(), "AppData/Local/Microsoft/Edge/Application/msedge.exe"),
    path.join(os.homedir(), "AppData/Local/BraveSoftware/Brave-Browser/Application/brave.exe"),
    path.join(os.homedir(), "AppData/Local/Chromium/Application/chrome.exe"),
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    `${os.homedir()}/Applications/Chromium.app/Contents/MacOS/Chromium`,
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/brave-browser",
    "/snap/bin/chromium",
    "/usr/lib/chromium/chromium",
    "/usr/lib/chromium-browser/chromium-browser",
  ],
};

let _cachedChromePath: string | null = null;

/**
 * Find Chrome/Chromium/Edge on the system.
 * Checks known paths first, then falls back to `where`/`which` commands.
 */
export function findChrome(): string | null {
  if (_cachedChromePath && existsSync(_cachedChromePath)) return _cachedChromePath;

  const platform = process.platform as string;
  const paths = KNOWN_PATHS[platform] || KNOWN_PATHS.linux;

  // 1. Check known paths
  for (const p of paths) {
    if (existsSync(p)) {
      _cachedChromePath = p;
      return p;
    }
  }

  // 2. Try which/where commands
  const commands = platform === "win32"
    ? ["where chrome", "where msedge", "where chromium", "where brave"]
    : ["which google-chrome", "which google-chrome-stable", "which chromium", "which chromium-browser", "which microsoft-edge"];

  for (const cmd of commands) {
    try {
      const result = execSync(cmd, { encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      const firstLine = result.split("\n")[0].trim();
      if (firstLine && existsSync(firstLine)) {
        _cachedChromePath = firstLine;
        return firstLine;
      }
    } catch {}
  }

  // 3. Windows: check registry
  if (platform === "win32") {
    const regKeys = [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
    ];
    for (const key of regKeys) {
      try {
        const result = execSync(`reg query "${key}" /ve`, { encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
        const match = result.match(/REG_SZ\s+(.+)/);
        if (match) {
          const p = match[1].trim();
          if (existsSync(p)) { _cachedChromePath = p; return p; }
        }
      } catch {}
    }
  }

  return null;
}

// ── Persistent browser instance ──────────────────────────────────────────────

let _browser: Browser | null = null;
let _browserLaunching: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  // Return existing browser if still connected
  if (_browser?.connected) return _browser;

  // Guard against concurrent launches
  if (_browserLaunching) return _browserLaunching;

  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome/Chromium/Edge not found on this system");

  _browserLaunching = puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--no-first-run",
      "--hide-scrollbars",
    ],
  });

  try {
    _browser = await _browserLaunching;

    // Auto-cleanup if browser disconnects
    _browser.on("disconnected", () => { _browser = null; });

    console.log(`[screenshot] Browser launched: ${chrome}`);
    return _browser;
  } finally {
    _browserLaunching = null;
  }
}

/** Close the persistent browser instance (call on server shutdown). */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
  }
}

// ── Screenshot capture ───────────────────────────────────────────────────────

interface ScreenshotOptions {
  width?: number;
  height?: number;
  timeout?: number;
  waitForNetwork?: boolean;
}

export interface ScreenshotResult {
  filePath: string;
  base64: string;
  sizeKB: number;
  title: string;
  analysis: string;
  consoleLogs: { level: string; text: string }[];
}

/**
 * Capture a screenshot of a URL.
 *
 * First call launches Chrome (~3-5s). Subsequent calls reuse the browser (<2s).
 * Returns the PNG file path, base64 data, and a text analysis of the page.
 */
export async function screenshot(
  url: string,
  outputPath: string,
  { width = 1440, height = 900, timeout = 20000, waitForNetwork = true }: ScreenshotOptions = {}
): Promise<ScreenshotResult> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setViewport({ width, height });

    // Capture console output (logs, warnings, errors)
    const consoleLogs: { level: string; text: string }[] = [];
    page.on("console", (msg) => {
      const level = msg.type(); // log, warn, error, info, debug
      const text = msg.text();
      if (text && consoleLogs.length < 50) {
        consoleLogs.push({ level, text: text.slice(0, 200) });
      }
    });

    // Capture uncaught page errors
    page.on("pageerror", (err) => {
      if (consoleLogs.length < 50) {
        consoleLogs.push({ level: "error", text: `Uncaught: ${err.message.slice(0, 200)}` });
      }
    });

    // Navigate and wait for page to be ready
    await page.goto(url, {
      waitUntil: waitForNetwork ? "networkidle0" : "domcontentloaded",
      timeout,
    });

    // Extra wait for JS rendering (SPAs, animations)
    await new Promise((r) => setTimeout(r, 1000));

    // Take screenshot
    const dir = path.dirname(outputPath);
    if (!existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    await page.screenshot({ path: outputPath, type: "png", fullPage: false });

    // Read the file for base64
    const buf = fs.readFileSync(outputPath);
    const base64 = buf.toString("base64");
    const sizeKB = Math.round(buf.length / 1024);

    // Extract page analysis (runs inside Chrome — sees the real rendered DOM)
    const analysis = await page.evaluate(() => {
      const lines: string[] = [];

      // Title
      if (document.title) lines.push(`Title: ${document.title}`);

      // Headings
      const headings: string[] = [];
      document.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
        headings.push(`${h.tagName.toLowerCase()}: "${(h.textContent || "").trim().slice(0, 60)}"`);
      });
      if (headings.length) lines.push(`Headings: ${headings.join(", ")}`);

      // Structure
      const tags: Record<string, number> = {};
      ["header", "nav", "main", "section", "article", "aside", "footer", "form", "button", "input", "img", "a", "ul", "ol", "table"].forEach((tag) => {
        const count = document.querySelectorAll(tag).length;
        if (count) tags[tag] = count;
      });
      if (Object.keys(tags).length) {
        lines.push(`Structure: ${Object.entries(tags).map(([t, c]) => `${t}(${c})`).join(", ")}`);
      }

      // Images
      const imgs: string[] = [];
      document.querySelectorAll("img").forEach((img) => {
        if ((img as HTMLImageElement).src) imgs.push((img as HTMLImageElement).src.slice(0, 80));
      });
      if (imgs.length) lines.push(`Images (${imgs.length}): ${imgs.slice(0, 5).join(", ")}`);

      // Computed colors from key elements
      const colors: string[] = [];
      ["body", "header", "nav", "main", "h1", "button"].forEach((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          const s = getComputedStyle(el);
          colors.push(`${sel}: bg=${s.backgroundColor}, color=${s.color}`);
        }
      });
      if (colors.length) { lines.push(""); lines.push("Colors:"); colors.forEach((c) => lines.push(`  ${c}`)); }

      // Visible text (first 15 text nodes from main content)
      const text: string[] = [];
      const main = document.querySelector("main") || document.body;
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode()) && text.length < 15) {
        const t = (n.textContent || "").trim();
        if (t.length > 3) text.push(t.slice(0, 80));
      }
      if (text.length) { lines.push(""); lines.push("Visible text:"); text.slice(0, 10).forEach((t) => lines.push(`  "${t}"`)); }

      return lines.join("\n");
    });

    const title = await page.title();

    return { filePath: outputPath, base64, sizeKB, title, analysis, consoleLogs };
  } finally {
    await page.close();
  }
}
