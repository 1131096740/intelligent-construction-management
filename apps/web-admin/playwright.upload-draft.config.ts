import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["upload-draft-feedback.e2e.ts", "contract-takeover-responsive.e2e.ts"],
  timeout: 45_000,
  expect: { timeout: 8_000 },
  workers: 1,
  retries: 0,
  reporter: "line",
  use: { baseURL: "http://127.0.0.1:4389", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4389 --strictPort",
    url: "http://127.0.0.1:4389",
    reuseExistingServer: false,
    timeout: 60_000
  }
});
