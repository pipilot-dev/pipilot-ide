import { test, expect } from "@playwright/test";

test.describe("PiPilot IDE - Full App Test", () => {
  test("full walkthrough: open preview, interact with chat, check tools", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);

    // 1. Verify IDE loaded
    await page.screenshot({ path: "tests/screenshots/01-ide-loaded.png", fullPage: true });
    console.log("Step 1: IDE loaded");

    // 2. Click on index.html in file tree
    const indexFile = page.locator("text=index.html").first();
    if (await indexFile.isVisible()) {
      await indexFile.click();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: "tests/screenshots/02-file-opened.png" });
      console.log("Step 2: Opened index.html");
    }

    // 3. Click "Open Web Preview" button or the Preview tab in the status bar
    const previewBtn = page.locator("text=Open Web Preview").first();
    const previewTab = page.locator("text=Preview").first();

    if (await previewBtn.isVisible().catch(() => false)) {
      await previewBtn.click();
      await page.waitForTimeout(2000);
      console.log("Step 3: Clicked Open Web Preview button");
    } else if (await previewTab.isVisible().catch(() => false)) {
      await previewTab.click();
      await page.waitForTimeout(2000);
      console.log("Step 3: Clicked Preview tab");
    }
    await page.screenshot({ path: "tests/screenshots/03-preview-opened.png" });

    // 4. Check the chat panel - type a message
    const chatInput = page.locator('textarea').first();
    if (await chatInput.isVisible().catch(() => false)) {
      await chatInput.click();
      await chatInput.fill("Build a simple counter app with a button that increments a number");
      await page.screenshot({ path: "tests/screenshots/04-chat-typed.png" });
      console.log("Step 4: Typed in chat");
    }

    // 5. Check the file tree is interactive
    const files = page.locator('[class*="file"], [class*="tree"]').locator("text=app.js");
    if (await files.first().isVisible().catch(() => false)) {
      await files.first().click();
      await page.waitForTimeout(500);
      console.log("Step 5: Clicked app.js in file tree");
    }
    await page.screenshot({ path: "tests/screenshots/05-file-tree.png" });

    // 6. Check for Sandpack preview iframe
    const iframes = page.locator("iframe");
    const iframeCount = await iframes.count();
    console.log(`Step 6: Found ${iframeCount} iframes`);

    if (iframeCount > 0) {
      // Try interacting with the preview
      const frame = page.frameLocator("iframe").first();
      try {
        await frame.locator("body").waitFor({ timeout: 5000 });
        const bodyText = await frame.locator("body").textContent({ timeout: 3000 });
        console.log(`Preview content: "${bodyText?.trim().slice(0, 100)}"`);
        await page.screenshot({ path: "tests/screenshots/06-preview-content.png" });

        // Try clicking something in the preview
        const buttons = frame.locator("button");
        const btnCount = await buttons.count().catch(() => 0);
        if (btnCount > 0) {
          await buttons.first().click();
          await page.waitForTimeout(500);
          console.log("Clicked a button in preview!");
          await page.screenshot({ path: "tests/screenshots/07-preview-clicked.png" });
        }

        // Try scrolling the preview
        await frame.locator("body").evaluate((body) => {
          body.scrollBy(0, 300);
        }).catch(() => {});
        await page.screenshot({ path: "tests/screenshots/08-preview-scrolled.png" });
      } catch (e) {
        console.log("Preview frame access:", (e as Error).message.slice(0, 100));
      }
    }

    // 7. Test keyboard shortcuts
    await page.keyboard.press("Control+b");
    await page.waitForTimeout(500);
    await page.screenshot({ path: "tests/screenshots/09-sidebar-toggled.png" });
    console.log("Step 7: Toggled sidebar with Ctrl+B");

    // 8. Check the status bar
    const statusBar = page.locator('[class*="status"], [class*="StatusBar"]').first();
    if (await statusBar.isVisible().catch(() => false)) {
      await page.screenshot({ path: "tests/screenshots/10-status-bar.png" });
      console.log("Step 8: Status bar visible");
    }

    // 9. Check the settings icon
    const settingsBtn = page.locator('[class*="settings"], button:has(svg)').last();
    if (await settingsBtn.isVisible().catch(() => false)) {
      await settingsBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: "tests/screenshots/11-settings.png" });
      console.log("Step 9: Opened settings");
    }

    console.log("\n=== Full app test completed ===");
  });
});
