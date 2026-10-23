import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "personnel-feedback.e2e.ts",
  outputDir: "test-results/personnel-feedback",
  timeout: 30_000,
  workers: 1,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:5202", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 5202 --strictPort",
    url: "http://127.0.0.1:5202",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } }
  ]
});
