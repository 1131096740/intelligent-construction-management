import { defineConfig, devices } from "@playwright/test";

const pnpmCommand = JSON.stringify(process.env.PNPM_BIN ?? "pnpm");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "settlement-entry-history-real.e2e.ts",
  timeout: 30_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure"
  },
  webServer: {
    command: `${pnpmCommand} dev --host 127.0.0.1 --port 5173 --strictPort`,
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } }
  ]
});
