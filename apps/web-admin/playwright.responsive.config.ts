import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4178";

export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "responsive-layout-foundation.e2e.ts",
    "ledger-responsive.e2e.ts",
    "flow-detail-responsive.e2e.ts"
  ],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: process.env.PLAYWRIGHT_RESPONSIVE_OUTPUT_DIR ?? join(tmpdir(), "jgzg-responsive-browser"),
  use: { baseURL, actionTimeout: 10_000, trace: "retain-on-failure" },
  webServer: {
    command: "pnpm preview --host 127.0.0.1 --port 4178 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
  ]
});
