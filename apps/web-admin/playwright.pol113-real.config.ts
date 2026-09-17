import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "pol113-settings-real.e2e.ts",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: "/private/tmp/jgzg-pol113-6wrahc-browser-results",
  use: { baseURL: "http://127.0.0.1:4213" },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 4213 --strictPort",
    url: "http://127.0.0.1:4213",
    reuseExistingServer: false,
    env: { VITE_API_PROXY_TARGET: "http://127.0.0.1:4313" }
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } },
    { name: "mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } }
  ]
});
