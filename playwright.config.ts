import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:51730",
    screenshot: "on",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev:client",
    port: 51730,
    reuseExistingServer: true,
  },
});
