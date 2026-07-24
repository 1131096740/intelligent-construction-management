import { defineConfig, devices } from "@playwright/test";

// WebKit 26.5 blocks 4190 as a restricted network port, so the persistent
// cross-browser gate uses the next isolated safe port.
const baseURL = "http://127.0.0.1:4193";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "admin-navigation-scroll.e2e.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "line",
  outputDir: "/tmp/jgzg-admin-navigation-scroll-e2e",
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
  ],
  webServer: {
    command: "pnpm build && pnpm preview --host 127.0.0.1 --port 4193 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
