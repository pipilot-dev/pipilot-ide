import { test } from "@playwright/test";

test("Ask AI to use interactive tools (click, scroll, find elements)", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2000);

  // 1. First, send a message to build something interactive
  const chatInput = page.locator("textarea").first();
  await chatInput.waitFor({ state: "visible", timeout: 10000 });
  await chatInput.click();
  await chatInput.fill("Build a simple todo app with an input field, an add button, and a list. Then use preview_find_elements to discover what interactive elements are on the page, then use preview_click to click the add button, and preview_type to type 'Buy groceries' into the input field. Test the app using the browser interaction tools.");

  await page.screenshot({ path: "tests/screenshots/interactive-01-prompt.png" });
  console.log("Step 1: Typed prompt asking AI to use interactive tools");

  // 2. Click Send
  const sendBtn = page.locator("button:has-text('Send'), button[type='submit']").last();
  await sendBtn.click();
  await page.waitForTimeout(1000);
  console.log("Step 2: Sent message");

  // 3. Monitor the response - watch for interactive tool calls
  let foundInteractiveTool = false;
  let toolsFound: string[] = [];

  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(3000);

    // Take periodic screenshots
    if (i % 5 === 0 || i < 5) {
      await page.screenshot({ path: `tests/screenshots/interactive-03-tick-${i}.png` });
    }

    // Check for specific interactive tool indicators
    const pageText = await page.locator("body").textContent().catch(() => "");

    const interactiveTools = [
      "Find Elements", "Click Element", "Type Text", "Scroll Preview",
      "preview_find_elements", "preview_click", "preview_type", "preview_scroll"
    ];

    for (const tool of interactiveTools) {
      if (pageText?.includes(tool) && !toolsFound.includes(tool)) {
        toolsFound.push(tool);
        console.log(`  Tick ${i}: Found interactive tool: ${tool}`);
        foundInteractiveTool = true;
        await page.screenshot({ path: `tests/screenshots/interactive-tool-${tool.replace(/\s+/g, '-').toLowerCase()}.png` });
      }
    }

    // Also check for Screenshot Preview (the existing tool)
    if (pageText?.includes("Screenshot Preview") && !toolsFound.includes("Screenshot Preview")) {
      toolsFound.push("Screenshot Preview");
      console.log(`  Tick ${i}: Found Screenshot Preview tool`);
    }

    // Check for tool call cards with specific classes
    const toolCards = page.locator('[class*="tool"], [class*="Tool"]');
    const toolCount = await toolCards.count();

    if (i % 5 === 0) {
      console.log(`  Tick ${i}: ${toolCount} tool cards visible, tools found so far: [${toolsFound.join(", ")}]`);
    }

    // Check if response is complete (Send button reappears)
    const sendVisible = await page.locator("button:has-text('Send')").isVisible().catch(() => false);
    if (sendVisible && i > 10) {
      console.log(`  Tick ${i}: Response complete. Send button visible again.`);
      break;
    }
  }

  // 4. Final comprehensive screenshot
  await page.screenshot({ path: "tests/screenshots/interactive-04-final.png" });
  console.log("\nStep 4: Final state");
  console.log(`Interactive tools detected: ${foundInteractiveTool}`);
  console.log(`Tools found: [${toolsFound.join(", ")}]`);

  // 5. Scroll up through the chat to capture all tool calls
  const chatContainer = page.locator('[class*="overflow-y"], [class*="chat"], [class*="messages"]').first();
  if (await chatContainer.isVisible().catch(() => false)) {
    // Scroll to top of chat
    await chatContainer.evaluate(el => el.scrollTop = 0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "tests/screenshots/interactive-05-chat-top.png" });
    console.log("Step 5: Captured chat from top");

    // Scroll through middle
    await chatContainer.evaluate(el => el.scrollTop = el.scrollHeight / 3);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "tests/screenshots/interactive-05-chat-mid1.png" });

    await chatContainer.evaluate(el => el.scrollTop = (el.scrollHeight / 3) * 2);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "tests/screenshots/interactive-05-chat-mid2.png" });

    // Scroll to bottom
    await chatContainer.evaluate(el => el.scrollTop = el.scrollHeight);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "tests/screenshots/interactive-05-chat-bottom.png" });
    console.log("Step 5: Captured full chat scroll");
  }

  // 6. Check the preview to see if the todo app was built
  const previewTab = page.locator("text=Preview").first();
  if (await previewTab.isVisible().catch(() => false)) {
    await previewTab.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/screenshots/interactive-06-preview.png" });
    console.log("Step 6: Preview captured");
  }

  console.log("\n=== Interactive tools test completed ===");
  console.log(`RESULT: ${foundInteractiveTool ? "SUCCESS - Interactive tools were used!" : "FAIL - No interactive tools detected"}`);
});
