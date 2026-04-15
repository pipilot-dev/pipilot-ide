/**
 * screenshot.ts — Zero-dependency screenshot capture using system Chrome/Chromium.
 *
 * Uses Chrome's built-in --headless --screenshot flag.
 * Auto-detects Chrome/Chromium/Edge on Windows, macOS, and Linux.
 * No Puppeteer, no Playwright, no npm packages.
 */

import { execSync, execFileSync } from "child_process";
import { existsSync } from "fs";
import * as path from "path";
import * as os from "os";

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

  // 3. Windows: check registry for Chrome install path
  if (platform === "win32") {
    try {
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
            if (existsSync(p)) {
              _cachedChromePath = p;
              return p;
            }
          }
        } catch {}
      }
    } catch {}
  }

  return null;
}

// ── Screenshot capture ───────────────────────────────────────────────────────

interface ScreenshotOptions {
  width?: number;
  height?: number;
  timeout?: number; // ms
}

/**
 * Capture a screenshot of a URL using headless Chrome.
 *
 * @param url      — URL to capture (e.g. "http://localhost:3000")
 * @param output   — Absolute path to save the PNG (e.g. "/tmp/screenshot.png")
 * @param options  — Width, height, timeout
 * @returns true if screenshot was saved successfully
 */
export function screenshot(
  url: string,
  output: string,
  { width = 1440, height = 900, timeout = 15000 }: ScreenshotOptions = {}
): boolean {
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome/Chromium/Edge not found on this system");

  // Ensure output directory exists
  const dir = path.dirname(output);
  if (!existsSync(dir)) {
    const { mkdirSync } = require("fs");
    mkdirSync(dir, { recursive: true });
  }

  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--no-first-run",
    "--hide-scrollbars",
    `--screenshot=${output}`,
    `--window-size=${width},${height}`,
    // Wait for page to fully load
    "--virtual-time-budget=5000",
    url,
  ];

  try {
    execFileSync(chrome, args, {
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
      // Prevent Chrome from using too much memory
      env: { ...process.env, CHROME_FLAGS: "--disable-gpu" },
    });
    return existsSync(output);
  } catch (err: any) {
    // Chrome sometimes exits with code 1 but still saves the screenshot
    if (existsSync(output)) return true;
    throw new Error(`Chrome screenshot failed: ${err.message?.slice(0, 200)}`);
  }
}
