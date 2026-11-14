import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: ["task12-archive-consumer.e2e.ts", "contract-governance.e2e.ts"], timeout: 45_000,
  expect: { timeout: 8_000 }, workers: 1, retries: 0, reporter: [["list"]],
  outputDir: process.env.TASK12_ARCHIVE_OUTPUT,
  use: { baseURL: "http://127.0.0.1:54913", trace: "retain-on-failure", serviceWorkers: "block", actionTimeout: 8_000 },
  webServer: { command: "node scripts/task12-mock-vite.mjs 54913",
    url: "http://127.0.0.1:54913", reuseExistingServer: false, timeout: 60_000 },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } } }]
});
