import { test } from "@playwright/test";

test("AI chat panel - send message and watch response", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(2000);

  // 1. Find and fill the chat input
  const chatInput = page.locator("textarea").first();
  await chatInput.waitFor({ state: "visible", timeout: 10000 });
  await chatInput.click();
  await chatInput.fill("Build a simple counter app with + and - buttons");
  await page.screenshot({ path: "tests/screenshots/chat-01-typed.png" });
  console.log("Step 1: Typed message in chat");

  // 2. Click Send button
  const sendBtn = page.locator("button:has-text('Send'), button[type='submit']").last();
  await sendBtn.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "tests/screenshots/chat-02-sent.png" });
  console.log("Step 2: Clicked Send");

  // 3. Wait for AI response to start streaming
  // Look for tool calls or assistant message bubbles
  console.log("Step 3: Waiting for AI response...");

  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `tests/screenshots/chat-03-response-${i}.png` });

    // Check for tool call indicators or assistant text
    const toolCalls = page.locator('[class*="tool"], [class*="Tool"]');
    const toolCount = await toolCalls.count();

    const assistantMsgs = page.locator('[class*="assistant"], [class*="bot"], [class*="message"]');
    const msgCount = await assistantMsgs.count();

    // Check if the chat input is enabled again (meaning response is done)
    const isStreaming = await page.locator('[class*="streaming"], [class*="loading"], [class*="spinner"]').count();

    // Check if there's a "Stop" button visible (indicates streaming)
    const stopBtn = page.locator("button:has-text('Stop')");
    const hasStop = await stopBtn.isVisible().catch(() => false);

    console.log(`  Tick ${i}: tools=${toolCount}, messages=${msgCount}, streaming=${isStreaming > 0 || hasStop}`);

    // If we see tool calls or the response seems done, take a final screenshot
    if (toolCount > 0) {
      console.log("  -> Tool calls detected!");
    }

    // Check if Send button is back (response complete)
    const sendVisible = await page.locator("button:has-text('Send')").isVisible().catch(() => false);
    if (sendVisible && i > 3) {
      console.log("  -> Send button reappeared, response likely complete");
      break;
    }
  }

  // 4. Final screenshot of the full conversation
  await page.screenshot({ path: "tests/screenshots/chat-04-final.png", fullPage: true });
  console.log("Step 4: Final state captured");

  // 5. Check if preview updated with the counter app
  const previewTab = page.locator("text=Preview").first();
  if (await previewTab.isVisible().catch(() => false)) {
    await previewTab.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "tests/screenshots/chat-05-preview-result.png" });
    console.log("Step 5: Preview after AI built the app");
  }

  // 6. Scroll up in the chat to see the full conversation
  const chatPanel = page.locator('[class*="chat"], [class*="Chat"]').first();
  if (await chatPanel.isVisible().catch(() => false)) {
    await chatPanel.evaluate((el) => el.scrollTop = 0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: "tests/screenshots/chat-06-scrolled-up.png" });
    console.log("Step 6: Scrolled up in chat");
  }

  console.log("\n=== Chat test completed ===");
});
