import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", testMatch: /approval-progress\.e2e\.ts/, workers: 1,
  timeout: 45000, expect: { timeout: 10000 }, reporter: "line",
  outputDir: process.env.APPROVAL_PROGRESS_TEST_OUTPUT ?? "test-results/approval-progress",
  use: { baseURL: "http://127.0.0.1:4192", trace: "retain-on-failure" },
  webServer: { command: "pnpm preview --host 127.0.0.1 --port 4192 --strictPort", url: "http://127.0.0.1:4192", reuseExistingServer: false },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } }
  ]
});
