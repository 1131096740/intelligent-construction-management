import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: "employee-onboarding.e2e.ts", timeout: 30_000, workers: 1,
  use: { baseURL: "http://127.0.0.1:5198", trace: "retain-on-failure" },
  webServer: { command: "pnpm dev --host 127.0.0.1 --port 5198 --strictPort", url: "http://127.0.0.1:5198", reuseExistingServer: false, timeout: 120_000 },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } }]
});
