import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4179";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "funds-workbench.e2e.ts",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "line",
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: "pnpm preview --host 127.0.0.1 --port 4179 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
  ]
});
