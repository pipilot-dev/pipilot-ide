import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:5173",
    screenshot: "on",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npx vite --host",
    port: 5173,
    reuseExistingServer: true,
  },
});
