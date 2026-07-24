import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4192";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "contract-clause-save-lifecycle.e2e.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "line",
  outputDir: "/tmp/jgzg-contract-clause-save-e2e",
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
  ],
  webServer: {
    command: "pnpm build && pnpm preview --host 127.0.0.1 --port 4192 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
