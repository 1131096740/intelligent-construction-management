import { defineConfig, devices } from "@playwright/test";

const api = process.env.PERSONNEL_API_URL;
if (!api || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(api)) throw new Error("人事生命周期验收只允许隔离本机 API");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "personnel-lifecycle-real.e2e.ts",
  outputDir: "test-results/personnel-lifecycle-real",
  timeout: 30_000,
  workers: 1,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:5203", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 5203 --strictPort --force",
    env: { VITE_API_PROXY_TARGET: api },
    url: "http://127.0.0.1:5203",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } }
  ]
});
