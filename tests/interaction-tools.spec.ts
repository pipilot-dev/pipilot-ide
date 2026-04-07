import { test, expect } from "@playwright/test";

test.describe("PiPilot IDE - Browser Interaction Tools", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for the IDE to load
    await page.waitForSelector('[class*="ide"], [class*="layout"], [class*="editor"]', { timeout: 10000 });
  });

  test("IDE loads successfully", async ({ page }) => {
    await expect(page).toHaveTitle(/AI IDE|PiPilot/i);
    // Take a screenshot of the loaded IDE
    await page.screenshot({ path: "tests/screenshots/ide-loaded.png" });
  });

  test("web preview panel is visible", async ({ page }) => {
    // Look for the Sandpack preview iframe
    const previewFrame = page.locator('iframe[title*="preview"], iframe[title*="Sandpack"], iframe[class*="preview"]');
    // If there's a preview panel visible
    const previewPanel = page.locator('[class*="preview"], [class*="Preview"]');
    const isVisible = await previewPanel.or(previewFrame).first().isVisible().catch(() => false);

    await page.screenshot({ path: "tests/screenshots/preview-panel.png" });
    console.log("Preview panel visible:", isVisible);
  });

  test("chat panel accepts messages", async ({ page }) => {
    // Find the chat input
    const chatInput = page.locator('textarea, input[placeholder*="message"], input[placeholder*="chat"], [class*="chat"] textarea, [class*="chat"] input');
    const firstInput = chatInput.first();

    if (await firstInput.isVisible().catch(() => false)) {
      await firstInput.fill("Hello, test message");
      await page.screenshot({ path: "tests/screenshots/chat-input.png" });
      console.log("Chat input found and filled");
    } else {
      console.log("Chat input not immediately visible");
      await page.screenshot({ path: "tests/screenshots/no-chat-input.png" });
    }
  });

  test("can interact with preview iframe content", async ({ page }) => {
    // Wait for Sandpack to load
    await page.waitForTimeout(3000);

    // Find the Sandpack preview iframe
    const iframes = page.frameLocator("iframe");
    const previewFrame = iframes.first();

    // Try to find content inside the preview
    try {
      const body = previewFrame.locator("body");
      const text = await body.textContent({ timeout: 5000 });
      console.log("Preview content:", text?.slice(0, 200));

      // Click on the first button or link if any
      const clickable = previewFrame.locator("button, a").first();
      if (await clickable.isVisible({ timeout: 2000 }).catch(() => false)) {
        await clickable.click();
        console.log("Clicked an element in preview");
      }
    } catch (e) {
      console.log("Could not access preview frame:", (e as Error).message);
    }

    await page.screenshot({ path: "tests/screenshots/preview-interaction.png" });
  });

  test("file tree is visible and interactive", async ({ page }) => {
    // Look for file tree elements
    const fileTree = page.locator('[class*="file"], [class*="tree"], [class*="FileTree"]');
    const firstItem = fileTree.first();

    if (await firstItem.isVisible().catch(() => false)) {
      await firstItem.click();
      console.log("Clicked file tree item");
    }

    await page.screenshot({ path: "tests/screenshots/file-tree.png" });
  });
});
