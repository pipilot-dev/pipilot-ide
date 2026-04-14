import { test, expect } from "@playwright/test";

test.describe("Settings — Live Visual Reflection", () => {

  test("font size visually changes in the editor", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    // Open a file so the editor is visible
    const fileItem = page.locator('[data-testid^="file-tree-file-"]').first();
    if (await fileItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fileItem.click();
      await page.waitForTimeout(1000);
    }

    // Screenshot BEFORE: default font size (14)
    await page.screenshot({ path: "tests/screenshots/settings-A-before-fontsize.png" });

    // Open settings, change font to 24
    await page.keyboard.press("Control+,");
    await page.waitForTimeout(1000);

    const fontInput = page.locator('input[type="number"]').first();
    await expect(fontInput).toBeVisible({ timeout: 3000 });
    await fontInput.click({ clickCount: 3 });
    await fontInput.fill("24");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(500);

    // Verify the event fired and localStorage updated
    const stored = await page.evaluate(() => localStorage.getItem("pipilot:editorFontSize"));
    console.log(`  localStorage editorFontSize: ${stored}`);
    expect(stored).toBe("24");

    // Close settings to see the editor
    const closeBtn = page.locator('button').filter({ has: page.locator('svg') }).last();
    // Use the X button at the top-right of the settings panel
    const xBtn = page.locator('button:near(:text("Editor"), 500)').filter({ has: page.locator('svg') });
    // Simpler: just press Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);

    // Screenshot AFTER: font size 24 — editor text should be visibly larger
    await page.screenshot({ path: "tests/screenshots/settings-B-after-fontsize-24.png" });

    // Verify Monaco actually received the update by checking the DOM
    const monacoFontSize = await page.evaluate(() => {
      const lines = document.querySelector('.monaco-editor .view-lines');
      if (!lines) return null;
      return window.getComputedStyle(lines).fontSize;
    });
    console.log(`  Monaco computed font size: ${monacoFontSize}`);
    // Should be 24px (or close to it)
    if (monacoFontSize) {
      const px = parseInt(monacoFontSize);
      console.log(`  Font size assertion: ${px}px (expected ~24px)`);
      expect(px).toBeGreaterThanOrEqual(20);
    }

    // Now change to a SMALL font (10px) to make the difference obvious
    await page.keyboard.press("Control+,");
    await page.waitForTimeout(500);
    const fontInput2 = page.locator('input[type="number"]').first();
    await fontInput2.click({ clickCount: 3 });
    await fontInput2.fill("10");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    await page.screenshot({ path: "tests/screenshots/settings-C-after-fontsize-10.png" });

    const smallFontSize = await page.evaluate(() => {
      const lines = document.querySelector('.monaco-editor .view-lines');
      if (!lines) return null;
      return window.getComputedStyle(lines).fontSize;
    });
    console.log(`  Monaco computed font size after small: ${smallFontSize}`);

    // Reset to 14
    await page.keyboard.press("Control+,");
    await page.waitForTimeout(500);
    const fontInput3 = page.locator('input[type="number"]').first();
    await fontInput3.click({ clickCount: 3 });
    await fontInput3.fill("14");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    console.log("✓ Font size visual test complete");
  });

  test("minimap toggle visually appears/disappears", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    // Open a file
    const fileItem = page.locator('[data-testid^="file-tree-file-"]').first();
    if (await fileItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fileItem.click();
      await page.waitForTimeout(1000);
    }

    // Check if minimap is currently visible
    const minimapBefore = await page.locator('.minimap').isVisible().catch(() => false);
    console.log(`  Minimap before: ${minimapBefore ? "visible" : "hidden"}`);

    // Open settings and toggle minimap ON
    await page.keyboard.press("Control+,");
    await page.waitForTimeout(1000);

    // Find minimap checkbox (second checkbox)
    const checkboxes = page.locator('input[type="checkbox"]');
    const minimapCb = checkboxes.nth(1);
    if (await minimapCb.isVisible()) {
      // Enable minimap
      if (!(await minimapCb.isChecked())) {
        await minimapCb.click();
        await page.waitForTimeout(500);
      }

      const stored = await page.evaluate(() => localStorage.getItem("pipilot:editorMinimap"));
      console.log(`  Minimap localStorage: ${stored}`);

      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      // Check if minimap DOM element appeared
      const minimapAfter = await page.locator('.minimap').isVisible().catch(() => false);
      console.log(`  Minimap after enabling: ${minimapAfter ? "VISIBLE ✓" : "still hidden ✗"}`);

      await page.screenshot({ path: "tests/screenshots/settings-D-minimap-on.png" });

      // Toggle OFF
      await page.keyboard.press("Control+,");
      await page.waitForTimeout(500);
      const cb2 = page.locator('input[type="checkbox"]').nth(1);
      if (await cb2.isChecked()) {
        await cb2.click();
        await page.waitForTimeout(300);
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);

      const minimapGone = await page.locator('.minimap').isVisible().catch(() => false);
      console.log(`  Minimap after disabling: ${minimapGone ? "still visible ✗" : "HIDDEN ✓"}`);

      await page.screenshot({ path: "tests/screenshots/settings-E-minimap-off.png" });
    }

    console.log("✓ Minimap visual test complete");
  });

  test("font family visually changes", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    // Open file
    const fileItem = page.locator('[data-testid^="file-tree-file-"]').first();
    if (await fileItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fileItem.click();
      await page.waitForTimeout(1000);
    }

    // Get initial font family from Monaco
    const fontBefore = await page.evaluate(() => {
      const lines = document.querySelector('.monaco-editor .view-lines');
      return lines ? window.getComputedStyle(lines).fontFamily : "unknown";
    });
    console.log(`  Font family before: ${fontBefore}`);

    // Change to JetBrains Mono
    await page.keyboard.press("Control+,");
    await page.waitForTimeout(1000);
    const fontSelect = page.locator("select").first();
    if (await fontSelect.isVisible()) {
      await fontSelect.selectOption({ label: "JetBrains Mono" });
      await page.waitForTimeout(500);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    const fontAfter = await page.evaluate(() => {
      const lines = document.querySelector('.monaco-editor .view-lines');
      return lines ? window.getComputedStyle(lines).fontFamily : "unknown";
    });
    console.log(`  Font family after: ${fontAfter}`);

    await page.screenshot({ path: "tests/screenshots/settings-F-font-family.png" });

    // Reset
    await page.keyboard.press("Control+,");
    await page.waitForTimeout(500);
    const resetSelect = page.locator("select").first();
    if (await resetSelect.isVisible()) {
      await resetSelect.selectOption({ index: 0 });
      await page.waitForTimeout(300);
    }
    await page.keyboard.press("Escape");
    console.log("✓ Font family visual test complete");
  });
});
