# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: input-latency.spec.ts >> Chat input latency benchmark
- Location: tests\input-latency.spec.ts:3:1

# Error details

```
TimeoutError: page.waitForSelector: Timeout 20000ms exceeded.
Call log:
  - waiting for locator('[data-testid="status-bar"]') to be visible

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - img "PiPilot" [ref=e5]
  - generic [ref=e6]: PiPilot IDE
  - generic [ref=e7]: Preparing your workspace
```

# Test source

```ts
  1  | import { test } from "@playwright/test";
  2  | 
  3  | test("Chat input latency benchmark", async ({ page }) => {
  4  |   await page.goto("http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
  5  | 
  6  |   // Wait for IDE to fully load (splash screen disappears)
> 7  |   await page.waitForSelector('[data-testid="status-bar"]', { timeout: 20000 });
     |              ^ TimeoutError: page.waitForSelector: Timeout 20000ms exceeded.
  8  |   await page.waitForTimeout(1000);
  9  | 
  10 |   // Find the chat textarea (may need to look for it in the chat panel)
  11 |   let textarea = page.locator("textarea").first();
  12 |   if (!(await textarea.isVisible({ timeout: 3000 }).catch(() => false))) {
  13 |     // Chat panel might be closed — try clicking the chat toggle
  14 |     const chatBtn = page.locator('button:has-text("Chat"), [data-testid="chat-toggle"]').first();
  15 |     if (await chatBtn.isVisible().catch(() => false)) {
  16 |       await chatBtn.click();
  17 |       await page.waitForTimeout(500);
  18 |     }
  19 |     textarea = page.locator("textarea").first();
  20 |   }
  21 |   await textarea.waitFor({ state: "visible", timeout: 10000 });
  22 |   await textarea.click();
  23 |   await page.waitForTimeout(300);
  24 | 
  25 |   const testString = "Hello world this is a typing latency test for the chat input";
  26 | 
  27 |   // Inject timing probe: measure time from keypress to React state update
  28 |   const latencies = await page.evaluate(async (chars: string) => {
  29 |     const ta = document.querySelector("textarea") as HTMLTextAreaElement;
  30 |     if (!ta) return { error: "no textarea" };
  31 |     ta.focus();
  32 | 
  33 |     const results: number[] = [];
  34 | 
  35 |     for (const char of chars) {
  36 |       const start = performance.now();
  37 | 
  38 |       // Simulate native input event (how React controlled inputs work)
  39 |       const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  40 |         window.HTMLTextAreaElement.prototype, "value"
  41 |       )!.set!;
  42 |       nativeInputValueSetter.call(ta, ta.value + char);
  43 |       ta.dispatchEvent(new Event("input", { bubbles: true }));
  44 | 
  45 |       // Wait for React to commit the update + paint
  46 |       await new Promise<void>((resolve) => {
  47 |         requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  48 |       });
  49 | 
  50 |       const elapsed = performance.now() - start;
  51 |       results.push(Math.round(elapsed * 10) / 10);
  52 |     }
  53 | 
  54 |     return {
  55 |       latencies: results,
  56 |       count: results.length,
  57 |       avg: Math.round(results.reduce((a, b) => a + b, 0) / results.length * 10) / 10,
  58 |       min: Math.round(Math.min(...results) * 10) / 10,
  59 |       max: Math.round(Math.max(...results) * 10) / 10,
  60 |       p95: Math.round([...results].sort((a, b) => a - b)[Math.floor(results.length * 0.95)] * 10) / 10,
  61 |       over16: results.filter((l) => l > 16.7).length,
  62 |       over33: results.filter((l) => l > 33).length,
  63 |       over50: results.filter((l) => l > 50).length,
  64 |       over100: results.filter((l) => l > 100).length,
  65 |     };
  66 |   }, testString);
  67 | 
  68 |   console.log("\n═══════════════════════════════════════");
  69 |   console.log("  CHAT INPUT LATENCY BENCHMARK");
  70 |   console.log("═══════════════════════════════════════");
  71 |   if ("error" in latencies) {
  72 |     console.log("ERROR:", latencies.error);
  73 |     return;
  74 |   }
  75 |   console.log(`  Chars typed:  ${latencies.count}`);
  76 |   console.log(`  Avg latency:  ${latencies.avg}ms`);
  77 |   console.log(`  Min:          ${latencies.min}ms`);
  78 |   console.log(`  Max:          ${latencies.max}ms`);
  79 |   console.log(`  P95:          ${latencies.p95}ms`);
  80 |   console.log(`  Over 16.7ms:  ${latencies.over16} (missed 60fps frame)`);
  81 |   console.log(`  Over 33ms:    ${latencies.over33} (missed 30fps frame)`);
  82 |   console.log(`  Over 50ms:    ${latencies.over50} (perceptible lag)`);
  83 |   console.log(`  Over 100ms:   ${latencies.over100} (noticeable stutter)`);
  84 |   console.log("───────────────────────────────────────");
  85 |   console.log(`  First 10: [${latencies.latencies.slice(0, 10).join(", ")}]`);
  86 |   console.log(`  Last 10:  [${latencies.latencies.slice(-10).join(", ")}]`);
  87 |   console.log("═══════════════════════════════════════\n");
  88 | });
  89 | 
```