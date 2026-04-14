import { test } from "@playwright/test";

test("Chat input latency benchmark", async ({ page }) => {
  await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });

  // Wait for IDE to fully load (splash screen disappears)
  await page.waitForSelector('[data-testid="status-bar"]', { timeout: 20000 });
  await page.waitForTimeout(1000);

  // Find the chat textarea (may need to look for it in the chat panel)
  let textarea = page.locator("textarea").first();
  if (!(await textarea.isVisible({ timeout: 3000 }).catch(() => false))) {
    // Chat panel might be closed — try clicking the chat toggle
    const chatBtn = page.locator('button:has-text("Chat"), [data-testid="chat-toggle"]').first();
    if (await chatBtn.isVisible().catch(() => false)) {
      await chatBtn.click();
      await page.waitForTimeout(500);
    }
    textarea = page.locator("textarea").first();
  }
  await textarea.waitFor({ state: "visible", timeout: 10000 });
  await textarea.click();
  await page.waitForTimeout(300);

  const testString = "Hello world this is a typing latency test for the chat input";

  // Inject timing probe: measure time from keypress to React state update
  const latencies = await page.evaluate(async (chars: string) => {
    const ta = document.querySelector("textarea") as HTMLTextAreaElement;
    if (!ta) return { error: "no textarea" };
    ta.focus();

    const results: number[] = [];

    for (const char of chars) {
      const start = performance.now();

      // Simulate native input event (how React controlled inputs work)
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, "value"
      )!.set!;
      nativeInputValueSetter.call(ta, ta.value + char);
      ta.dispatchEvent(new Event("input", { bubbles: true }));

      // Wait for React to commit the update + paint
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

      const elapsed = performance.now() - start;
      results.push(Math.round(elapsed * 10) / 10);
    }

    return {
      latencies: results,
      count: results.length,
      avg: Math.round(results.reduce((a, b) => a + b, 0) / results.length * 10) / 10,
      min: Math.round(Math.min(...results) * 10) / 10,
      max: Math.round(Math.max(...results) * 10) / 10,
      p95: Math.round([...results].sort((a, b) => a - b)[Math.floor(results.length * 0.95)] * 10) / 10,
      over16: results.filter((l) => l > 16.7).length,
      over33: results.filter((l) => l > 33).length,
      over50: results.filter((l) => l > 50).length,
      over100: results.filter((l) => l > 100).length,
    };
  }, testString);

  console.log("\n═══════════════════════════════════════");
  console.log("  CHAT INPUT LATENCY BENCHMARK");
  console.log("═══════════════════════════════════════");
  if ("error" in latencies) {
    console.log("ERROR:", latencies.error);
    return;
  }
  console.log(`  Chars typed:  ${latencies.count}`);
  console.log(`  Avg latency:  ${latencies.avg}ms`);
  console.log(`  Min:          ${latencies.min}ms`);
  console.log(`  Max:          ${latencies.max}ms`);
  console.log(`  P95:          ${latencies.p95}ms`);
  console.log(`  Over 16.7ms:  ${latencies.over16} (missed 60fps frame)`);
  console.log(`  Over 33ms:    ${latencies.over33} (missed 30fps frame)`);
  console.log(`  Over 50ms:    ${latencies.over50} (perceptible lag)`);
  console.log(`  Over 100ms:   ${latencies.over100} (noticeable stutter)`);
  console.log("───────────────────────────────────────");
  console.log(`  First 10: [${latencies.latencies.slice(0, 10).join(", ")}]`);
  console.log(`  Last 10:  [${latencies.latencies.slice(-10).join(", ")}]`);
  console.log("═══════════════════════════════════════\n");
});
