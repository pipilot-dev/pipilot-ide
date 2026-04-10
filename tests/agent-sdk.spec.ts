import { test, expect } from "@playwright/test";

test("Claude Agent mode — send message and see response", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(3000);

  // 1. Find and click the mode selector to switch to Claude Agent
  const modeBtn = page.locator('[data-testid="chat-mode-toggle"]');
  if (await modeBtn.isVisible({ timeout: 5000 })) {
    await modeBtn.click();
    await page.waitForTimeout(500);

    // Look for "Claude Agent" option
    const agentOption = page.locator('[data-testid="chat-mode-option-claude-agent"]');
    if (await agentOption.isVisible({ timeout: 2000 })) {
      await agentOption.click();
      await page.waitForTimeout(500);
      console.log("Step 1: Switched to Claude Agent mode");
      await page.screenshot({ path: "tests/screenshots/agent-01-mode-selected.png" });
    } else {
      console.log("Step 1: Claude Agent option not found, testing with current mode");
    }
  }

  // 2. Type a message
  const chatInput = page.locator("textarea").first();
  await chatInput.waitFor({ state: "visible", timeout: 10000 });
  await chatInput.click();
  await chatInput.fill("Say hello and tell me what files you can see in the project");
  await page.screenshot({ path: "tests/screenshots/agent-02-typed.png" });
  console.log("Step 2: Typed message");

  // 3. Send the message
  const sendBtn = page.locator("button:has-text('Send')").last();
  await sendBtn.click();
  console.log("Step 3: Sent message");

  // 4. Wait and observe the response
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `tests/screenshots/agent-03-response-${i}.png` });

    const pageText = await page.locator("body").textContent().catch(() => "");

    // Check for tool calls
    const hasToolCalls = pageText?.includes("Read") || pageText?.includes("Write") || pageText?.includes("Bash") || pageText?.includes("List");
    // Check for text response
    const hasResponse = pageText?.includes("hello") || pageText?.includes("Hello") || pageText?.includes("files");
    // Check if done (Send button visible again)
    const sendVisible = await page.locator("button:has-text('Send')").isVisible().catch(() => false);

    console.log(`  Tick ${i}: tools=${hasToolCalls}, response=${hasResponse}, done=${sendVisible && i > 2}`);

    if (sendVisible && i > 3) {
      console.log("  Response complete");
      break;
    }
  }

  // 5. Final screenshot
  await page.screenshot({ path: "tests/screenshots/agent-04-final.png" });
  console.log("Step 5: Test complete");
});
